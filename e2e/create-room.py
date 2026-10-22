# Registers three test users on the local Synapse and creates an encrypted room
# with all of them joined. Prints the room ID.
import json, urllib.request
HS="http://localhost:8008"
def req(method, path, body=None, token=None):
    r=urllib.request.Request(HS+path, method=method, data=json.dumps(body).encode() if body is not None else None, headers={"Content-Type":"application/json", **({"Authorization":"Bearer "+token} if token else {})})
    try:
        return json.load(urllib.request.urlopen(r))
    except urllib.error.HTTPError as e:
        return json.load(e)
tokens={}
for u in ["anna","ben","clara"]:
    r=req("POST","/_matrix/client/v3/register",{"username":u,"password":"testpass123","auth":{"type":"m.login.dummy"},"inhibit_login":False})
    if "access_token" not in r:
        r=req("POST","/_matrix/client/v3/login",{"type":"m.login.password","identifier":{"type":"m.id.user","user":u},"password":"testpass123"})
    tokens[u]=r["access_token"]
    req("PUT",f"/_matrix/client/v3/profile/@{u}:localhost:8448/displayname",{"displayname":u.capitalize()},tokens[u])
room=req("POST","/_matrix/client/v3/createRoom",{"name":"Encrypted Lounge","preset":"private_chat","initial_state":[{"type":"m.room.encryption","state_key":"","content":{"algorithm":"m.megolm.v1.aes-sha2"}}],"invite":["@ben:localhost:8448","@clara:localhost:8448"],
  "power_level_content_override":{"events":{"org.matrix.msc3401.call.member":0,"m.call.member":0,"org.matrix.msc3401.call":0,"m.call":0,"im.vector.modular.widgets":0,"io.element.widgets.layout":0}}},tokens["anna"])
rid=room["room_id"]
for u in ["ben","clara"]:
    req("POST",f"/_matrix/client/v3/rooms/{rid}/join",{},tokens[u])
print(rid)
