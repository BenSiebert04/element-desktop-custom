{
  "targets": [
    {
      "target_name": "app_audio",
      "sources": ["src/app_audio.cc"],
      "include_dirs": ["<!(node -p \"require('node-addon-api').include_dir\")"],
      "defines": ["NAPI_VERSION=8", "NAPI_CPP_EXCEPTIONS"],
      "cflags_cc": ["-fexceptions", "-std=c++17"],
      "conditions": [
        ["OS=='win'", {
          "libraries": ["mmdevapi.lib", "ole32.lib"],
          "defines": ["UNICODE", "_UNICODE", "WINVER=0x0A00", "_WIN32_WINNT=0x0A00"],
          "msvs_settings": {
            "VCCLCompilerTool": { "ExceptionHandling": 1, "AdditionalOptions": ["/std:c++17"] }
          }
        }]
      ]
    }
  ]
}
