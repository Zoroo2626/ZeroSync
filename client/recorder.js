// recorder.js - saves everything so you can replay training runs exactly
// the deterministic replay is lowkey one of the coolest features
// records: rng seed, events timeline, model checkpoints

/* global ZeroSyncModel */

const ZeroSyncRecorder = (() => {
    'use strict';

    // create a fresh recorder for a client
    function create(clientId, seed) {
        return {
            clientId: clientId,
            seed: seed,
            startTime: Date.now(),
            events: [],
            checkpoints: []
        };
    }

    // log an event (train step, update sent/received, etc)
    function recordEvent(recorder, type, data) {
        recorder.events.push({
            type: type,
            timestamp: Date.now() - recorder.startTime,
            data: data || {}
        });
    }

    // snapshot the model weights at a point in time
    function saveCheckpoint(recorder, label, weights) {
        recorder.checkpoints.push({
            label: label,
            timestamp: Date.now() - recorder.startTime,
            weights: weights
        });
    }

    // export the whole thing as json
    function exportReplay(recorder) {
        return JSON.stringify({
            version: '1.0.0',
            project: 'ZeroSync',
            clientId: recorder.clientId,
            seed: recorder.seed,
            startTime: recorder.startTime,
            events: recorder.events,
            checkpoints: recorder.checkpoints,
            exportedAt: Date.now()
        }, null, 2);
    }

    // trigger a file download in the browser
    function downloadReplay(recorder) {
        const json = exportReplay(recorder);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `replay_${recorder.clientId}_${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // parse a replay json back into an object
    function parseReplay(jsonStr) {
        try {
            const data = JSON.parse(jsonStr);
            if (data.project !== 'ZeroSync') {
                throw new Error('not a ZeroSync replay file');
            }
            return data;
        } catch (err) {
            throw new Error('replay parse failed: ' + err.message);
        }
    }

    return { create, recordEvent, saveCheckpoint, exportReplay, downloadReplay, parseReplay };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ZeroSyncRecorder;
}
