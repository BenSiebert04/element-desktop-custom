// Copyright 2026 Mosaix contributors.
// SPDX-License-Identifier: AGPL-3.0-only
//
// Captures the audio of one process tree on Windows ("process loopback",
// Windows 10 2004 / build 19041 and later):
//
//  - include: only what the given process and its children play
//             (sharing an application window: that application's sound)
//  - exclude: everything the system plays except the given process tree
//             (sharing the screen: system sound without Mosaix's own call)
//
// Audio is delivered as interleaved stereo float32 at 48 kHz.
//
// JavaScript API:
//   isSupported(): boolean
//   windowProcessId(hwnd: number): number      (0 if unknown)
//   new Capture(pid, "include" | "exclude", onData(Float32Array), onError(string))
//   capture.stop()

#include <napi.h>

#include <atomic>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <thread>
#include <vector>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <mmdeviceapi.h>
#include <mmreg.h>
#endif

namespace {

constexpr int kChannels = 2;
constexpr int kSampleRate = 48000;

#ifdef _WIN32

std::string HrMessage(const char* what, HRESULT hr) {
  char buf[16];
  snprintf(buf, sizeof(buf), "0x%08lX", static_cast<unsigned long>(hr));
  return std::string(what) + " failed (" + buf + ")";
}

// Receives the result of ActivateAudioInterfaceAsync.
class ActivationHandler : public IActivateAudioInterfaceCompletionHandler,
                          public IAgileObject {
 public:
  ActivationHandler() : done(CreateEventW(nullptr, TRUE, FALSE, nullptr)) {}

  STDMETHOD(QueryInterface)(REFIID riid, void** ppv) override {
    if (riid == __uuidof(IUnknown) ||
        riid == __uuidof(IActivateAudioInterfaceCompletionHandler)) {
      *ppv = static_cast<IActivateAudioInterfaceCompletionHandler*>(this);
    } else if (riid == __uuidof(IAgileObject)) {
      *ppv = static_cast<IAgileObject*>(this);
    } else {
      *ppv = nullptr;
      return E_NOINTERFACE;
    }
    AddRef();
    return S_OK;
  }
  STDMETHOD_(ULONG, AddRef)() override { return InterlockedIncrement(&refs_); }
  STDMETHOD_(ULONG, Release)() override {
    const ULONG refs = InterlockedDecrement(&refs_);
    if (refs == 0) delete this;
    return refs;
  }

  STDMETHOD(ActivateCompleted)(
      IActivateAudioInterfaceAsyncOperation* operation) override {
    HRESULT activated = E_FAIL;
    IUnknown* unknown = nullptr;
    const HRESULT hr = operation->GetActivateResult(&activated, &unknown);
    if (FAILED(hr)) {
      result = hr;
    } else if (FAILED(activated) || unknown == nullptr) {
      result = FAILED(activated) ? activated : E_FAIL;
    } else {
      result = unknown->QueryInterface(__uuidof(IAudioClient),
                                       reinterpret_cast<void**>(&client));
    }
    if (unknown) unknown->Release();
    SetEvent(done);
    return S_OK;
  }

  HANDLE done;
  HRESULT result = E_FAIL;
  IAudioClient* client = nullptr;

 private:
  ~ActivationHandler() {
    if (client) client->Release();
    if (done) CloseHandle(done);
  }
  LONG refs_ = 1;
};

bool WindowsSupportsProcessLoopback() {
  using RtlGetVersionFn = LONG(WINAPI*)(PRTL_OSVERSIONINFOW);
  const auto rtlGetVersion = reinterpret_cast<RtlGetVersionFn>(
      GetProcAddress(GetModuleHandleW(L"ntdll.dll"), "RtlGetVersion"));
  if (!rtlGetVersion) return false;
  RTL_OSVERSIONINFOW info = {};
  info.dwOSVersionInfoSize = sizeof(info);
  if (rtlGetVersion(&info) != 0) return false;
  return info.dwMajorVersion > 10 ||
         (info.dwMajorVersion == 10 && info.dwBuildNumber >= 19041);
}

#endif  // _WIN32

class Capture : public Napi::ObjectWrap<Capture> {
 public:
  static Napi::Function Init(Napi::Env env) {
    return DefineClass(env, "Capture",
                       {InstanceMethod("stop", &Capture::Stop)});
  }

  explicit Capture(const Napi::CallbackInfo& info)
      : Napi::ObjectWrap<Capture>(info) {
    Napi::Env env = info.Env();
#ifndef _WIN32
    Napi::Error::New(env, "Process audio capture needs Windows")
        .ThrowAsJavaScriptException();
#else
    if (info.Length() < 4 || !info[0].IsNumber() || !info[1].IsString() ||
        !info[2].IsFunction() || !info[3].IsFunction()) {
      Napi::TypeError::New(env, "Capture(pid, mode, onData, onError)")
          .ThrowAsJavaScriptException();
      return;
    }
    const DWORD pid = info[0].As<Napi::Number>().Uint32Value();
    const std::string mode = info[1].As<Napi::String>();
    if (pid == 0 || (mode != "include" && mode != "exclude")) {
      Napi::TypeError::New(env, "Invalid process id or mode")
          .ThrowAsJavaScriptException();
      return;
    }
    data_ = Napi::ThreadSafeFunction::New(env, info[2].As<Napi::Function>(),
                                          "app-audio data", 0, 1);
    error_ = Napi::ThreadSafeFunction::New(env, info[3].As<Napi::Function>(),
                                           "app-audio error", 0, 1);
    running_ = true;
    thread_ = std::thread([this, pid, mode] { Run(pid, mode == "include"); });
#endif
  }

  ~Capture() override { StopThread(); }

 private:
  Napi::Value Stop(const Napi::CallbackInfo& info) {
    StopThread();
    return info.Env().Undefined();
  }

  void StopThread() {
    running_ = false;
    if (thread_.joinable()) thread_.join();
  }

#ifdef _WIN32
  void Fail(const std::string& message) {
    auto* text = new std::string(message);
    const napi_status status = error_.BlockingCall(
        text, [](Napi::Env env, Napi::Function callback, std::string* text) {
          callback.Call({Napi::String::New(env, *text)});
          delete text;
        });
    if (status != napi_ok) delete text;
  }

  void Run(DWORD pid, bool include) {
    const bool comReady =
        SUCCEEDED(CoInitializeEx(nullptr, COINIT_MULTITHREADED));
    IAudioClient* client = nullptr;
    IAudioCaptureClient* capture = nullptr;
    HANDLE ready = nullptr;

    do {
      AUDIOCLIENT_ACTIVATION_PARAMS params = {};
      params.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
      params.ProcessLoopbackParams.TargetProcessId = pid;
      params.ProcessLoopbackParams.ProcessLoopbackMode =
          include ? PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE
                  : PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE;
      PROPVARIANT activation = {};
      activation.vt = VT_BLOB;
      activation.blob.cbSize = sizeof(params);
      activation.blob.pBlobData = reinterpret_cast<BYTE*>(&params);

      auto* handler = new ActivationHandler();
      IActivateAudioInterfaceAsyncOperation* operation = nullptr;
      HRESULT hr = ActivateAudioInterfaceAsync(
          VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, __uuidof(IAudioClient),
          &activation, handler, &operation);
      if (FAILED(hr)) {
        handler->Release();
        Fail(HrMessage("ActivateAudioInterfaceAsync", hr));
        break;
      }
      const DWORD waited = WaitForSingleObject(handler->done, 10000);
      if (operation) operation->Release();
      if (waited != WAIT_OBJECT_0 || FAILED(handler->result) ||
          handler->client == nullptr) {
        Fail(HrMessage("Process loopback activation",
                       waited != WAIT_OBJECT_0 ? HRESULT_FROM_WIN32(WAIT_TIMEOUT)
                                               : handler->result));
        handler->Release();
        break;
      }
      client = handler->client;
      client->AddRef();
      handler->Release();

      // Ask for float; fall back to 16-bit PCM
      WAVEFORMATEX format = {};
      format.wFormatTag = WAVE_FORMAT_IEEE_FLOAT;
      format.nChannels = kChannels;
      format.nSamplesPerSec = kSampleRate;
      format.wBitsPerSample = 32;
      format.nBlockAlign = format.nChannels * format.wBitsPerSample / 8;
      format.nAvgBytesPerSec = format.nSamplesPerSec * format.nBlockAlign;
      const DWORD flags = AUDCLNT_STREAMFLAGS_LOOPBACK |
                          AUDCLNT_STREAMFLAGS_EVENTCALLBACK |
                          AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM |
                          AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;
      constexpr REFERENCE_TIME kBuffer = 200000;  // 20 ms
      hr = client->Initialize(AUDCLNT_SHAREMODE_SHARED, flags, kBuffer, 0,
                              &format, nullptr);
      bool isFloat = true;
      if (FAILED(hr)) {
        format.wFormatTag = WAVE_FORMAT_PCM;
        format.wBitsPerSample = 16;
        format.nBlockAlign = format.nChannels * format.wBitsPerSample / 8;
        format.nAvgBytesPerSec = format.nSamplesPerSec * format.nBlockAlign;
        hr = client->Initialize(AUDCLNT_SHAREMODE_SHARED, flags, kBuffer, 0,
                                &format, nullptr);
        isFloat = false;
      }
      if (FAILED(hr)) {
        Fail(HrMessage("IAudioClient::Initialize", hr));
        break;
      }

      ready = CreateEventW(nullptr, FALSE, FALSE, nullptr);
      if (FAILED(hr = client->SetEventHandle(ready)) ||
          FAILED(hr = client->GetService(__uuidof(IAudioCaptureClient),
                                         reinterpret_cast<void**>(&capture))) ||
          FAILED(hr = client->Start())) {
        Fail(HrMessage("Starting the capture", hr));
        break;
      }

      while (running_) {
        if (WaitForSingleObject(ready, 100) != WAIT_OBJECT_0) continue;
        UINT32 packet = 0;
        while (running_ && SUCCEEDED(capture->GetNextPacketSize(&packet)) &&
               packet > 0) {
          BYTE* data = nullptr;
          UINT32 frames = 0;
          DWORD bufferFlags = 0;
          if (FAILED(capture->GetBuffer(&data, &frames, &bufferFlags, nullptr,
                                        nullptr))) {
            break;
          }
          auto* chunk = new std::vector<float>(frames * kChannels, 0.0f);
          if (!(bufferFlags & AUDCLNT_BUFFERFLAGS_SILENT)) {
            if (isFloat) {
              std::memcpy(chunk->data(), data, chunk->size() * sizeof(float));
            } else {
              const auto* samples = reinterpret_cast<const int16_t*>(data);
              for (size_t i = 0; i < chunk->size(); i++)
                (*chunk)[i] = samples[i] / 32768.0f;
            }
          }
          capture->ReleaseBuffer(frames);
          const napi_status status = data_.NonBlockingCall(
              chunk,
              [](Napi::Env env, Napi::Function callback,
                 std::vector<float>* chunk) {
                auto array = Napi::Float32Array::New(env, chunk->size());
                std::memcpy(array.Data(), chunk->data(),
                            chunk->size() * sizeof(float));
                delete chunk;
                callback.Call({array});
              });
          if (status != napi_ok) delete chunk;
        }
      }
      client->Stop();
    } while (false);

    if (capture) capture->Release();
    if (client) client->Release();
    if (ready) CloseHandle(ready);
    if (comReady) CoUninitialize();
    data_.Release();
    error_.Release();
  }
#endif

  std::atomic<bool> running_{false};
  std::thread thread_;
  Napi::ThreadSafeFunction data_;
  Napi::ThreadSafeFunction error_;
};

Napi::Value IsSupported(const Napi::CallbackInfo& info) {
#ifdef _WIN32
  return Napi::Boolean::New(info.Env(), WindowsSupportsProcessLoopback());
#else
  return Napi::Boolean::New(info.Env(), false);
#endif
}

Napi::Value WindowProcessId(const Napi::CallbackInfo& info) {
  uint32_t pid = 0;
#ifdef _WIN32
  if (info.Length() > 0 && info[0].IsNumber()) {
    const auto hwnd = static_cast<uintptr_t>(
        info[0].As<Napi::Number>().Int64Value());
    DWORD windowPid = 0;
    GetWindowThreadProcessId(reinterpret_cast<HWND>(hwnd), &windowPid);
    pid = windowPid;
  }
#endif
  return Napi::Number::New(info.Env(), pid);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("isSupported", Napi::Function::New(env, IsSupported));
  exports.Set("windowProcessId", Napi::Function::New(env, WindowProcessId));
  exports.Set("Capture", Capture::Init(env));
  return exports;
}

}  // namespace

NODE_API_MODULE(app_audio, Init)
