// webrtc.js - P2P data channel manager
// makes browsers talk directly to each other without going through the server
// the server only handles the initial handshake (SDP + ICE), everything else is p2p
// falls back to websocket if webrtc fails which honestly happens more than youd think

/* global */

const ZeroSyncWebRTC = (() => {
    'use strict';

    // no STUN/TURN needed locally, add google stun for LAN/WAN tho
    const RTC_CONFIG = { iceServers: [] };
    const CHANNEL_LABEL = 'zerosync-model-updates';

    /**
     * creates a new webrtc manager
     * clientId = who we are, ws = signaling websocket, onMessage = callback for incoming data
     */
    function create(clientId, ws, onMessage, onLog) {
        const peers = new Map(); // peerId -> { pc, dc, state }
        const log = onLog || function () { };

        // handle signaling messages from the server
        function handleSignalingMessage(msg) {
            if (msg.type === 'webrtc_offer') {
                handleOffer(msg.fromClient, msg.sdp);
            } else if (msg.type === 'webrtc_answer') {
                handleAnswer(msg.fromClient, msg.sdp);
            } else if (msg.type === 'webrtc_ice') {
                handleIceCandidate(msg.fromClient, msg.candidate);
            } else if (msg.type === 'peer_list') {
                // auto-connect to everyone we dont already know about
                if (msg.peers && Array.isArray(msg.peers)) {
                    for (const peerId of msg.peers) {
                        if (peerId !== clientId && !peers.has(peerId)) {
                            connectToPeer(peerId);
                        }
                    }
                }
            }
        }

        // initiate connection to a peer (we're the offerer here)
        function connectToPeer(peerId) {
            if (peers.has(peerId)) {
                log(`already got a connection to ${peerId}`, 'info');
                return;
            }

            log(`[WebRTC] connecting to ${peerId}...`, 'info');

            const pc = new RTCPeerConnection(RTC_CONFIG);
            const entry = { pc, dc: null, state: 'connecting' };
            peers.set(peerId, entry);

            // we create the data channel since we're initiating
            const dc = pc.createDataChannel(CHANNEL_LABEL, {
                ordered: true,
                maxRetransmits: 3
            });
            entry.dc = dc;

            setupDataChannel(dc, peerId);
            setupPeerConnection(pc, peerId);

            pc.createOffer()
                .then(offer => pc.setLocalDescription(offer))
                .then(() => {
                    sendSignaling({
                        type: 'webrtc_offer',
                        toClient: peerId,
                        fromClient: clientId,
                        sdp: pc.localDescription
                    });
                    log(`[WebRTC] sent offer to ${peerId}`, 'info');
                })
                .catch(err => {
                    log(`[WebRTC] offer failed for ${peerId}: ${err.message}`, 'error');
                    peers.delete(peerId);
                });
        }

        // someone sent us an offer, we respond with an answer
        async function handleOffer(peerId, sdp) {
            log(`[WebRTC] got offer from ${peerId}`, 'info');

            const pc = new RTCPeerConnection(RTC_CONFIG);
            const entry = { pc, dc: null, state: 'connecting' };
            peers.set(peerId, entry);

            setupPeerConnection(pc, peerId);

            // listen for their data channel
            pc.ondatachannel = (event) => {
                entry.dc = event.channel;
                setupDataChannel(event.channel, peerId);
            };

            try {
                await pc.setRemoteDescription(new RTCSessionDescription(sdp));
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);

                sendSignaling({
                    type: 'webrtc_answer',
                    toClient: peerId,
                    fromClient: clientId,
                    sdp: pc.localDescription
                });
                log(`[WebRTC] sent answer to ${peerId}`, 'info');
            } catch (err) {
                log(`[WebRTC] offer handling failed for ${peerId}: ${err.message}`, 'error');
                peers.delete(peerId);
            }
        }

        async function handleAnswer(peerId, sdp) {
            const entry = peers.get(peerId);
            if (!entry) {
                log(`[WebRTC] answer from unknown peer: ${peerId}`, 'error');
                return;
            }
            try {
                await entry.pc.setRemoteDescription(new RTCSessionDescription(sdp));
                log(`[WebRTC] connected to ${peerId} ✓`, 'success');
            } catch (err) {
                log(`[WebRTC] answer failed for ${peerId}: ${err.message}`, 'error');
            }
        }

        async function handleIceCandidate(peerId, candidate) {
            const entry = peers.get(peerId);
            if (!entry) return;
            try {
                if (candidate) await entry.pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (err) {
                // ice errors are super common and usually harmless
                log(`[WebRTC] ice hiccup for ${peerId}: ${err.message}`, 'info');
            }
        }

        function setupPeerConnection(pc, peerId) {
            pc.onicecandidate = (event) => {
                if (event.candidate) {
                    sendSignaling({
                        type: 'webrtc_ice',
                        toClient: peerId,
                        fromClient: clientId,
                        candidate: event.candidate
                    });
                }
            };

            pc.onconnectionstatechange = () => {
                const state = pc.connectionState;
                const entry = peers.get(peerId);
                if (entry) entry.state = state;

                if (state === 'connected') {
                    log(`[WebRTC] ✓ p2p with ${peerId} is live`, 'success');
                } else if (state === 'disconnected' || state === 'failed' || state === 'closed') {
                    log(`[WebRTC] ${state}: ${peerId}`, 'info');
                    cleanup(peerId);
                }
            };

            pc.oniceconnectionstatechange = () => {
                if (pc.iceConnectionState === 'failed') {
                    log(`[WebRTC] ice failed for ${peerId}, falling back to ws`, 'error');
                    cleanup(peerId);
                }
            };
        }

        function setupDataChannel(dc, peerId) {
            dc.onopen = () => {
                const entry = peers.get(peerId);
                if (entry) entry.state = 'open';
                log(`[WebRTC] data channel open with ${peerId} ✓`, 'success');
            };
            dc.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (onMessage) onMessage(peerId, data);
                } catch (err) {
                    log(`[WebRTC] bad data from ${peerId}: ${err.message}`, 'error');
                }
            };
            dc.onerror = (err) => {
                log(`[WebRTC] channel error with ${peerId}: ${err.message || 'idk'}`, 'error');
            };
            dc.onclose = () => {
                log(`[WebRTC] channel closed with ${peerId}`, 'info');
            };
        }

        function sendSignaling(msg) {
            try {
                if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
            } catch (err) {
                log(`[WebRTC] signaling error: ${err.message}`, 'error');
            }
        }

        function cleanup(peerId) {
            const entry = peers.get(peerId);
            if (entry) {
                try {
                    if (entry.dc) entry.dc.close();
                    entry.pc.close();
                } catch (e) { /* whatever lol */ }
                peers.delete(peerId);
            }
        }

        // send data to all connected peers
        function broadcast(data) {
            const payload = JSON.stringify(data);
            let sent = 0;
            peers.forEach((entry, peerId) => {
                if (entry.dc && entry.dc.readyState === 'open') {
                    try { entry.dc.send(payload); sent++; }
                    catch (err) { log(`[WebRTC] send failed to ${peerId}: ${err.message}`, 'error'); }
                }
            });
            return sent;
        }

        function getStats() {
            const stats = [];
            peers.forEach((entry, peerId) => {
                stats.push({
                    peerId,
                    state: entry.state,
                    channelState: entry.dc ? entry.dc.readyState : 'none'
                });
            });
            return stats;
        }

        function getConnectedCount() {
            let count = 0;
            peers.forEach(entry => {
                if (entry.dc && entry.dc.readyState === 'open') count++;
            });
            return count;
        }

        function closeAll() {
            peers.forEach((entry, peerId) => cleanup(peerId));
        }

        return { handleSignalingMessage, connectToPeer, broadcast, getStats, getConnectedCount, closeAll };
    }

    return { create };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ZeroSyncWebRTC;
}
