# Prepares the Private Voice end-to-end test on the local Synapse (localhost only):
# a space with four category sub-spaces, managed text and voice rooms, an unmanaged
# room and a direct message. Prints JSON with the room IDs and the manifest that the
# test later writes into Anna's account data. All data is synthetic.
import json, time, urllib.request, urllib.parse
HS = "http://localhost:8008"
SERVER = "localhost:8448"


def req(method, path, body=None, token=None):
    r = urllib.request.Request(HS + path, method=method,
                               data=json.dumps(body).encode() if body is not None else None,
                               headers={"Content-Type": "application/json",
                                        **({"Authorization": "Bearer " + token} if token else {})})
    try:
        return json.load(urllib.request.urlopen(r))
    except urllib.error.HTTPError as e:
        err = json.load(e)
        if e.code == 429:  # rate limited: Synapse says how long to wait
            time.sleep(err.get("retry_after_ms", 1000) / 1000 + 0.1)
            return req(method, path, body, token)
        return err


def login(user):
    r = req("POST", "/_matrix/client/v3/register",
            {"username": user, "password": "testpass123", "auth": {"type": "m.login.dummy"}})
    if "access_token" not in r:
        r = req("POST", "/_matrix/client/v3/login",
                {"type": "m.login.password", "identifier": {"type": "m.id.user", "user": user},
                 "password": "testpass123"})
    req("PUT", f"/_matrix/client/v3/profile/@{user}:{SERVER}/displayname", {"displayname": user.capitalize()},
        r["access_token"])
    return r["access_token"]


anna, ben = login("pvanna"), login("pvben")
CALL_PL = {"events": {"org.matrix.msc3401.call.member": 0, "m.call.member": 0, "org.matrix.msc3401.call": 0,
                      "m.call": 0, "im.vector.modular.widgets": 0, "io.element.widgets.layout": 0}}


def create(name, space=False, encrypted=False, invite=()):
    body = {"name": name, "preset": "private_chat", "invite": list(invite), "power_level_content_override": CALL_PL}
    if space:
        body["creation_content"] = {"type": "m.space"}
    if encrypted:
        body["initial_state"] = [{"type": "m.room.encryption", "state_key": "",
                                  "content": {"algorithm": "m.megolm.v1.aes-sha2"}}]
    rid = req("POST", "/_matrix/client/v3/createRoom", body, anna)["room_id"]
    for _ in invite:
        req("POST", f"/_matrix/client/v3/rooms/{urllib.parse.quote(rid)}/join", {}, ben)
    return rid


def add_child(parent, child):
    req("PUT", f"/_matrix/client/v3/rooms/{urllib.parse.quote(parent)}/state/m.space.child/{urllib.parse.quote(child)}",
        {"via": [SERVER]}, anna)


def send(rid, text):
    txn = urllib.parse.quote(f"{rid}-{text}")
    req("PUT", f"/_matrix/client/v3/rooms/{urllib.parse.quote(rid)}/send/m.room.message/{txn}",
        {"msgtype": "m.text", "body": text}, anna)


space = create("PV Beispielserver", space=True, invite=["@pvben:" + SERVER])
categories = {}
for key, name, order in [("archive", "Archiv", 3), ("general", "Allgemein", 0), ("projects", "Projekte", 2),
                         ("gaming", "Gaming", 1)]:
    categories[key] = (create("Kategorie " + name, space=True), name, order)
    add_child(space, categories[key][0])

rooms = {}
for key, name, kind, cat, matrix_only, media, enc in [
    ("general_text", "💬 allgemein", "text", "general", False, ["text"], "none"),
    ("general_voice", "🔊 Treffpunkt", "voice", "general", False, ["audio"], "none"),
    ("gaming_text", "🎮 gaming-chat", "text", "gaming", False, ["text"], "none"),
    ("gaming_voice", "🔊 Zocken", "voice", "gaming", True, [], "e2ee"),
    ("projects_text", "📁 projekte", "text", "projects", True, [], "e2ee"),
    ("archive_text", "📦 alt", "text", "archive", False, ["text"], "none"),
]:
    rid = create("matrix-" + key, encrypted=enc == "e2ee", invite=["@pvben:" + SERVER])
    add_child(categories[cat][0], rid)
    rooms[key] = {"room_id": rid, "name": name, "kind": kind, "category_id": categories[cat][0],
                  "matrix_only": matrix_only, "bridged_media": media, "expected_matrix_encryption": enc}

# Jam channel: members may share their Spotify Jam (state event per member,
# key "jam/" + Matrix ID); the room's policy names the checking service
JAM_TYPE = "io.github.bensiebert04.mosaix.jam"
JAM_POLICY_TYPE = "io.github.bensiebert04.mosaix.jam.policy"
CHECKER = "@pvcheck:" + SERVER
checker = login("pvcheck")
jam_room = req("POST", "/_matrix/client/v3/createRoom", {
    "name": "matrix-jams", "preset": "private_chat", "invite": ["@pvben:" + SERVER, CHECKER],
    "power_level_content_override": {"events": {**CALL_PL["events"], JAM_TYPE: 0, JAM_POLICY_TYPE: 100}}},
    anna)["room_id"]
for token in (ben, checker):
    req("POST", f"/_matrix/client/v3/rooms/{urllib.parse.quote(jam_room)}/join", {}, token)
req("PUT", f"/_matrix/client/v3/rooms/{urllib.parse.quote(jam_room)}/state/{JAM_POLICY_TYPE}/",
    {"checker": CHECKER}, anna)
add_child(categories["general"][0], jam_room)
rooms["jams"] = {"room_id": jam_room, "name": "🎵 Jams", "kind": "jam", "category_id": categories["general"][0],
                 "matrix_only": True, "bridged_media": [], "expected_matrix_encryption": "none"}


def put_jam(owner, content, token):
    key = urllib.parse.quote("jam/" + owner, safe="")
    return req("PUT", f"/_matrix/client/v3/rooms/{urllib.parse.quote(jam_room)}/state/{JAM_TYPE}/{key}",
               content, token)


# Ben is running a Jam
put_jam("@pvben:" + SERVER, {"url": "https://open.spotify.com/socialsession/BenJam42", "title": "Bens Abendmix",
                             "started_ts": int(time.time() * 1000) - 7 * 60000, "status": "active"}, ben)
# Ben under Anna's key: not Anna's Jam, never shown
put_jam("@pvanna:" + SERVER, {"url": "https://open.spotify.com/socialsession/Fake1", "title": "Gefälscht",
                              "started_ts": int(time.time() * 1000), "status": "active"}, ben)

lobby = create("Unverwaltete Lobby", invite=["@pvben:" + SERVER])
add_child(space, lobby)
send(rooms["general_text"]["room_id"], "Nachricht vor der Konfiguration")

dm = req("POST", "/_matrix/client/v3/createRoom",
         {"preset": "trusted_private_chat", "is_direct": True, "invite": ["@pvben:" + SERVER],
          "power_level_content_override": CALL_PL}, anna)["room_id"]
req("POST", f"/_matrix/client/v3/rooms/{urllib.parse.quote(dm)}/join", {}, ben)
req("PUT", f"/_matrix/client/v3/user/@pvanna:{SERVER}/account_data/m.direct", {"@pvben:" + SERVER: [dm]}, anna)

manifest = {
    "schema_version": 1,
    "user_id": "@pvanna:" + SERVER,
    "revision": "1" * 64,
    "ui": {
        "categories": {"presentation": "collapsible_sections", "preserve_user_overrides": True},
        "managed_text_rooms": {"show_call_controls": False},
        "managed_voice_rooms": {"default_view": "call_lobby", "allow_companion_chat": True},
        "unmanaged_rooms": "preserve",
    },
    "spaces": [{
        "space_id": space,
        "name": "PV Beispielserver",
        "categories": [{"category_id": rid, "name": name, "order": order,
                        "section_tag": "element.io.section.pvb." + key}
                       for key, (rid, name, order) in categories.items()],
        "rooms": list(rooms.values()),
        # Fields a newer server might add are ignored
        "future_field": {"anything": True},
    }],
}
print(json.dumps({"space": space, "rooms": {k: v["room_id"] for k, v in rooms.items()}, "lobby": lobby, "dm": dm,
                  "manifest": manifest}))
