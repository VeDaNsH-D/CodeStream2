require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const axios = require('axios');

const app = express();
const server = http.createServer(app);

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling']
});

let rooms = {};
const languageMap = {
    'javascript': 63,
    'python': 71,
    'java': 62,
    'c': 50,
    'cpp': 54
};
const getRandomColor = () => `#${Math.floor(Math.random()*16777215).toString(16).padStart(6, '0')}`;

function getDetailedErrorExplanation(status, stderr, compile_output) {
    if (compile_output) {
        return `Compilation Error:\n${compile_output}`;
    }
    if (stderr) {
        return `Runtime Error:\n${stderr}`;
    }
    const id = status?.id;
    const description = status?.description || "Unknown Error";
    switch (id) {
        case 5:
            return `Error: Time Limit Exceeded.\nYour program took too long to execute. This can be caused by an infinite loop or an inefficient algorithm.`;
        case 6:
            return `Error: Compilation Failed.\nPlease check for syntax errors.`;
        case 7:
            return `Error: Runtime Error (Segmentation Fault).\nYour program tried to access a memory location it wasn't allowed to.`;
        case 11:
            return `Error: Runtime Error (Non-Zero Exit Code).\nYour program exited with an error status, often due to an unhandled exception.`;
        default:
            return `An error occurred: ${description}`;
    }
}

const pollForResult = async (token, socket) => {
    // Poll up to 7 times (14 seconds total)
    for (let i = 0; i < 7; i++) {
        try {
            await new Promise(resolve => setTimeout(resolve, 2000));
            const resultResponse = await axios.request({
                method: 'GET',
                url: `https://judge0-ce.p.rapidapi.com/submissions/${token}`,
                params: {
                    base64_encoded: 'false',
                    fields: '*'
                },
                headers: {
                    'X-RapidAPI-Key': process.env.API_KEY,
                    'X-RapidAPI-Host': 'judge0-ce.p.rapidapi.com'
                }
            });

            const statusId = resultResponse.data.status?.id;

            // Status 1: In Queue, Status 2: Processing. Anything else means it's done.
            if (statusId > 2) {
                const {
                    stdout,
                    stderr,
                    compile_output,
                    status
                } = resultResponse.data;
                const detailedError = (status.id > 3) ? getDetailedErrorExplanation(status, stderr, compile_output) : null;
                socket.emit('code-output', {
                    stdout: stdout || '',
                    stderr: detailedError,
                    status: status?.description || 'Error'
                });
                return;
            }
        } catch (pollError) {
            console.error('Judge0 Poll Error:', pollError.response ? pollError.response.data : pollError.message);
            socket.emit('code-output', {
                stderr: 'Failed to retrieve execution result.',
                stdout: ''
            });
            return;
        }
    }
    socket.emit('code-output', {
        stderr: 'Execution timed out.',
        stdout: ''
    });
};

io.on('connection', (socket) => {
    let currentRoomId = null;
    let currentUser = null;

    socket.on('join-room', ({ roomId, username }) => {
        // Leave previous room if any
        if (currentRoomId && rooms[currentRoomId]?.participants) {
            socket.leave(currentRoomId);
            delete rooms[currentRoomId].participants[socket.id];
            io.to(currentRoomId).emit('user-left', { userId: socket.id });
        }

        currentRoomId = roomId;
        currentUser = {
            id: socket.id,
            username,
            color: getRandomColor()
        };

        // Create room if it doesn't exist
        if (!rooms[roomId]) {
            rooms[roomId] = {
                participants: {},
                files: {
                    'main.py': `print("Hello, collaborative world!")`
                }
            };
        }

        socket.join(roomId);
        rooms[roomId].participants[socket.id] = currentUser;

        // Send initial state to the new user
        socket.emit('initial-sync', {
            files: rooms[roomId].files,
            participants: rooms[roomId].participants,
            currentUser: currentUser
        });

        // Notify others in the room
        socket.to(roomId).emit('user-joined', {
            user: currentUser
        });
    });

    socket.on('file-add', ({ path }) => {
        if (rooms[currentRoomId]) {
            rooms[currentRoomId].files[path] = '';
            io.to(currentRoomId).emit('file-add', { path });
        }
    });

    socket.on('file-rename', ({ oldPath, newPath }) => {
        if (rooms[currentRoomId]?.files[oldPath] !== undefined) {
            rooms[currentRoomId].files[newPath] = rooms[currentRoomId].files[oldPath];
            delete rooms[currentRoomId].files[oldPath];
            io.to(currentRoomId).emit('file-rename', { oldPath, newPath });
        }
    });

    socket.on('file-delete', ({ path }) => {
        if (rooms[currentRoomId]?.files[path] !== undefined) {
            delete rooms[currentRoomId].files[path];
            io.to(currentRoomId).emit('file-delete', { path });
        }
    });

    socket.on('code-change', ({ path, newCode }) => {
        if (rooms[currentRoomId]?.files[path] !== undefined) {
            rooms[currentRoomId].files[path] = newCode;
            socket.to(currentRoomId).emit('code-change', { path, newCode });
        }
    });

    socket.on('run-code', async ({ language, code, currentFile, stdin }) => {
        if (!currentUser) return;

        socket.to(currentRoomId).emit('execution-notification', {
            username: currentUser.username,
            file: currentFile
        });

        const languageId = languageMap[language];
        if (!languageId) {
            return socket.emit('code-output', {
                stderr: 'Unsupported language.',
                stdout: ''
            });
        }

        const options = {
            method: 'POST',
            url: 'https://judge0-ce.p.rapidapi.com/submissions',
            params: {
                base64_encoded: 'false',
                fields: '*'
            },
            headers: {
                'content-type': 'application/json',
                'X-RapidAPI-Key': process.env.API_KEY,
                'X-RapidAPI-Host': 'judge0-ce.p.rapidapi.com'
            },
            data: {
                language_id: languageId,
                source_code: code,
                stdin: stdin
            }
        };

        try {
            const submissionResponse = await axios.request(options);
            const token = submissionResponse.data.token;
            if (token) {
                pollForResult(token, socket);
            } else {
                socket.emit('code-output', {
                    stderr: 'Failed to create submission.',
                    stdout: ''
                });
            }
        } catch (submitError) {
            console.error('Judge0 Submit Error:', submitError.response ? submitError.response.data : submitError.message);
            socket.emit('code-output', {
                stderr: 'An error occurred during code submission.',
                stdout: ''
            });
        }
    });

    socket.on('send-chat-message', ({ message }) => {
        if (currentUser) {
            io.to(currentRoomId).emit('receive-chat-message', {
                user: currentUser,
                message
            });
        }
    });

    socket.on('large-paste', () => {
        if (currentUser) {
            socket.to(currentRoomId).emit('paste-notification', {
                username: currentUser.username
            });
        }
    });

    // --- WebRTC Signaling ---
    const relaySignal = (event, payload) => {
        const { to } = payload;
        if (rooms[currentRoomId]?.participants[to]) {
            socket.to(to).emit(event, { ...payload,
                from: socket.id
            });
        }
    };

    socket.on('webrtc-offer', (payload) => relaySignal('webrtc-offer', payload));
    socket.on('webrtc-answer', (payload) => relaySignal('webrtc-answer', payload));
    socket.on('webrtc-ice-candidate', (payload) => relaySignal('webrtc-ice-candidate', payload));


    socket.on('disconnect', () => {
        if (currentRoomId && rooms[currentRoomId]?.participants[socket.id]) {
            delete rooms[currentRoomId].participants[socket.id];
            io.to(currentRoomId).emit('user-left', {
                userId: socket.id
            });
            // If the room is empty, delete it
            if (Object.keys(rooms[currentRoomId].participants).length === 0) {
                delete rooms[currentRoomId];
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Code Stream server running on port ${PORT}`);
});
