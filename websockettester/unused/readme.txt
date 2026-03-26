VRChat Avatar HTTP Tester v2 - Documentation
===========================================

This server (httpTESTER.js) acts as a bridge between the VRChat Auto Avatar Changer 
browser extension and your control system. It uses simple HTTP GET requests to 
manage avatar changes for multiple users simultaneously.

1. Architecture Overview
------------------------
The extension (background script) polls this server every 3 seconds per active 
VRChat tab. The server identifies users by their VRChat User ID (usr_...) and 
optionally by their Username for better logging and UI management.

2. Endpoints Detail
-------------------

A. Polling Endpoint
   URL: GET /poll/:userId?username=:username
   Description:
   This is the heart of the system. The browser extension continuously hits this
   URL to ask: "Is there a new avatar I should switch to for this specific user?"

   Parameters:
   - :userId (Path Segment): The VRChat User ID (e.g., usr_f5)
   - username (Query Param): The literal display name of the user (e.g., "[redacted]").

   Internal Logic:
   1. The server records the mapping between the User ID and the Username.
   2. It logs the poll request along with the IP address and identity.
   3. It checks its internal 'userAvatars' map for a pending avatar ID for this user.
   4. It returns a JSON object: { "avatarId": "avtr_...", "status": "ok" } or 
      { "avatarId": null, "status": "ok" } if no change is pending.

B. Change Endpoint
   URL: GET /change?userId=:userId&avatarId=:avatarId
   Description:
   Use this endpoint to trigger an avatar change command for a specific user.

   Parameters:
   - userId: The target VRChat User ID.
   - avatarId: The avatar ID to switch to (e.g., avtr_c38...).

   Internal Logic:
   1. The server stores the 'avatarId' in its map under the 'userId'.
   2. The next time the extension polls for this 'userId', it will receive the 
      new avatar ID and execute the change on the VRChat website.

C. Clear Endpoint
   URL: GET /change?userId=:userId&clear=1
   Description:
   Clears the pending avatar for a specific user. (Omit userId to clear all).

   Internal Logic:
   1. Removes the entry from the internal map.
   2. The extension will stop receiving "new avatar" commands for that user.

D. Web Interface (Chat/Admin UI)
   URL: GET /chat or GET /
   Description:
   A human-readable dashboard to monitor and control all connected users.

   Features:
   - Shows a list of all users who have polled the server since it started.
   - Displays the current target avatar for each user.
   - Provides an input field and "Set" button to manually trigger changes.
   - Automatically refreshes every 10 seconds.

3. Logging
----------
All activity is logged to the server console and the internal log buffer 
displayed in the web interface. Logs include:
- Polling events (Who and from where)
- Change requests (Which avatar for which user)
- Registration events (Associating Username with User ID)

4. Setup & Requirements
-----------------------
- Port: 297 (Default)
- No external dependencies required (Uses built-in Node.js 'http' module).
- Run with: node httpTESTER.js
