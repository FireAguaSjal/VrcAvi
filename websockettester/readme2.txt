VRChat Sync: Secure Endpoint Guide (README v2)
==============================================

This document describes the exact URL structure and security requirements for 
the VRChat Avatar Changer backend (httpTESTER.js).

1. Authentication Requirements
------------------------------
Every request now requires two pieces of information:
- PIN: A 4-digit code created in the extension popup.
- TOKEN: A unique session token provided by the server after a successful login.

2. Registration & Dynamic Token
-------------------------------
The first time you poll with a new PIN, the server will register you and 
provide a TOKEN in the JSON response. Save this token and use it for 
subsequent requests. If you don't poll for 40 seconds, your token expires 
and you must acquire a new one.

3. Endpoints Structure
----------------------

A. The Polling Endpoint (Used by Extension)
   URL: GET http://localhost:297/poll/:userId?pin=:pin&token=:token&username=:username

   - :userId   = The VRChat User ID (usr_...)
   - :pin      = Your 4-digit security PIN
   - :token    = Your current active session token
   - :username = (Optional) For server-side logging

   RESPONSE: { "avatarId": "avtr_...", "status": "ok", "token": "NEW_TOKEN_IF_NEEDED" }

B. The Change Endpoint (Commanding a Change)
   URL: GET http://localhost:297/change/:userId/:avatarId/:pin/:token

   - userId    = The Target User ID
   - avatarId  = The Avatar to switch to
   - pin       = Valid PIN for the target user
   - token     = Valid session token for the target user

   EXAMPLE: http://localhost:297/change/usr_xxx/avtr_yyy/1111/abcde12345

4. Security Logic & Failures
----------------------------
- IP Lock: If an incorrect PIN is provided, the requesting IP is blocked for 5 minutes.
- Account Conflict: If a user ID is active on one IP and a second IP tries to access 
  the same user ID, the second IP is blocked for 5 minutes.
- Hashing: All data in auth.json is salted and hashed (Sha256) for privacy.

5. Restricted IP (2a06:98c0:3600::103)
--------------------------------------
This specific IP is restricted to "Change Only". They can visit the /chat 
dashboard and trigger avatar changes, but they cannot view the current 
avatar IDs or the status of other users.

6. Introduction Page
--------------------
Any direct URL access (like /chat) from an unauthorized IP or without a valid 
session redirects to intro.html.
