// signaling.js - websocket server for ZeroSync
// handles client registration, relays webrtc signaling (SDP + ICE),
// broadcasts model updates, and saves them to disk for the aggregator
// port 4200 by default, change with SIGNALING_PORT env var

'use strict';

const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const net = require('net');

const PORT = parseInt(process.env.SIGNALING_PORT, 10) || 4200;
const UPDATES_DIR = path.join(__dirname, 'updates');

// make sure updates dir exists
try {
    if (!fs.existsSync(UPDATES_DIR)) fs.mkdirSync(UPDATES_DIR, { recursive: true });
} catch (err) {
    console.error(`[server] cant create updates dir: ${err.message}`);
    process.exit(1);
}

// check if port is taken before we try to use it
function checkPort(port) {
    return new Promise((resolve, reject) => {
        const tester = net.createServer()
            .once('error', (err) => {
                if (err.code === 'EADDRINUSE') {
                    reject(new Error(
                        `port ${port} already in use\n` +
                        `  kill it: lsof -ti:${port} | xargs kill -9\n` +
                        `  or use diff port: SIGNALING_PORT=4201 node signaling.js`
                    ));
                } else {
                    reject(err);
                }
            })
            .once('listening', () => tester.close(() => resolve()))
            .listen(port);
    });
}

async function startServer() {
    try { await checkPort(PORT); }
    catch (err) { console.error(`[server] ${err.message}`); process.exit(1); }

    const wss = new WebSocket.Server({ port: PORT });
    const clients = new Map();       // ws -> clientId
    const clientsById = new Map();   // clientId -> ws (for targeted relay)
    let updateCounter = 0;

    console.log(`[server] running on ws://127.0.0.1:${PORT}`);
    console.log(`[server] updates saved to: ${UPDATES_DIR}`);

    wss.on('connection', (ws) => {
        let clientId = 'unknown';

        ws.on('message', (raw) => {
            let msg;
            try { msg = JSON.parse(raw.toString()); }
            catch (err) { console.error(`[server] bad json: ${err.message}`); return; }

            // -- registration --
            if (msg.type === 'register') {
                clientId = msg.clientId || 'client_' + Date.now();
                clients.set(ws, clientId);
                clientsById.set(clientId, ws);
                console.log(`[server] ${clientId} joined (total: ${clients.size})`);

                // send them the list of existing peers for webrtc setup
                const peerList = [];
                clients.forEach((id, peer) => { if (peer !== ws) peerList.push(id); });
                try { ws.send(JSON.stringify({ type: 'peer_list', peers: peerList })); }
                catch (e) { /* nbd */ }

                broadcastPeerCount(wss, clients);
                return;
            }

            // -- webrtc signaling relay --
            // just forward offers/answers/ice to the right peer
            if (msg.type === 'webrtc_offer' || msg.type === 'webrtc_answer' || msg.type === 'webrtc_ice') {
                const targetWs = clientsById.get(msg.toClient);
                if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                    try {
                        targetWs.send(JSON.stringify(msg));
                        console.log(`[server] relayed ${msg.type}: ${msg.fromClient} → ${msg.toClient}`);
                    } catch (err) {
                        console.error(`[server] relay error: ${err.message}`);
                    }
                } else {
                    console.log(`[server] target ${msg.toClient} not found for ${msg.type}`);
                }
                return;
            }

            // -- model update --
            if (msg.type === 'model_update') {
                console.log(`[server] update from ${msg.clientId}: [${(msg.summaryVector || []).join(', ')}]`);

                // save to disk so the aggregator can pick it up later
                try {
                    updateCounter++;
                    const filename = `update_${updateCounter}_${msg.clientId}_${Date.now()}.json`;
                    fs.writeFileSync(path.join(UPDATES_DIR, filename), JSON.stringify(msg, null, 2));
                    console.log(`[server] saved: ${filename}`);
                } catch (err) {
                    console.error(`[server] save error: ${err.message}`);
                }

                // broadcast to everyone else
                wss.clients.forEach((peer) => {
                    if (peer !== ws && peer.readyState === WebSocket.OPEN) {
                        try { peer.send(JSON.stringify(msg)); }
                        catch (err) { /* happens sometimes w/ slow peers */ }
                    }
                });
                return;
            }

            console.log(`[server] unknown msg type: ${msg.type}`);
        });

        ws.on('close', () => {
            console.log(`[server] ${clientId} left`);
            clients.delete(ws);
            clientsById.delete(clientId);
            broadcastPeerCount(wss, clients);
        });

        ws.on('error', (err) => {
            console.error(`[server] ws error for ${clientId}: ${err.message}`);
        });
    });

    // clean shutdown
    process.on('SIGINT', () => {
        console.log('\n[server] shutting down...');
        wss.close(() => { console.log('[server] bye'); process.exit(0); });
    });
    process.on('SIGTERM', () => { wss.close(() => process.exit(0)); });
}

function broadcastPeerCount(wss, clients) {
    const msg = JSON.stringify({ type: 'peer_count', count: clients.size });
    wss.clients.forEach((peer) => {
        if (peer.readyState === WebSocket.OPEN) {
            try { peer.send(msg); } catch (err) { /* meh */ }
        }
    });
}

startServer();
