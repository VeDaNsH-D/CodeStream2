require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const axios = require('axios');
const session = require('express-session');
const SequelizeStore = require('connect-session-sequelize')(session.Store);

// Database & Auth
const { sequelize, Room, File, Message, User, initDB } = require('./src/db');
const passport = require('./src/auth/passport');
const authRoutes = require('./src/auth/routes');

const app = express();
const server = http.createServer(app);

// Initialize DB
initDB();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session Setup
const sessionStore = new SequelizeStore({
    db: sequelize,
});
// Sync session table
sessionStore.sync();

app.use(session({
    secret: process.env.SESSION_SECRET || 'supersecretkey',
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Passport Setup
app.use(passport.initialize());
app.use(passport.session());

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Auth Routes
app.use('/auth', authRoutes);

// User Rooms API
app.get('/api/user/rooms', async (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const user = await User.findByPk(req.user.id, {
            include: [{
                model: Room,
                as: 'joinedRooms',
                attributes: ['id', 'name', 'updatedAt'],
                through: { attributes: [] }
            }],
            order: [[{ model: Room, as: 'joinedRooms' }, 'updatedAt', 'DESC']]
        });
        res.json({ rooms: user ? user.joinedRooms : [] });
    } catch (err) {
        console.error("Error fetching rooms:", err);
        res.status(500).json({ error: 'Failed to fetch room history' });
    }
});

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling']
});

// We still need to track connected users per room in memory for presence (participants list),
// but the room data itself (files, messages) comes from DB.
// Structure: { roomId: { participants: { socketId: { ...userData } } } }
let activeRooms = {};

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

    socket.on('join-room', async ({ roomId, username, userId }) => { // Expect userId now if available, otherwise just username
        // Leave previous room if any
        if (currentRoomId && activeRooms[currentRoomId]?.participants) {
            socket.leave(currentRoomId);
            delete activeRooms[currentRoomId].participants[socket.id];
            io.to(currentRoomId).emit('user-left', { userId: socket.id });
        }

        currentRoomId = roomId;
        // Use provided userId or fallback to socket id if guest (though logic should encourage login)
        // Ideally, we get user info from session if we shared session with socket.io,
        // but for now we'll trust the client sending the username/ID after login.

        currentUser = {
            id: socket.id, // Socket ID for WebRTC/Routing
            dbUserId: userId, // Actual DB ID if logged in
            username,
            color: getRandomColor()
        };

        // Create active room tracking if not exists
        if (!activeRooms[roomId]) {
            activeRooms[roomId] = {
                participants: {}
            };
        }

        socket.join(roomId);
        activeRooms[roomId].participants[socket.id] = currentUser;

        // DB Operations: Find/Create Room and Load State
        try {
            const [room, created] = await Room.findOrCreate({
                where: { id: roomId },
                defaults: { name: roomId }
            });

            if (currentUser.dbUserId) {
                try {
                    const dbUser = await User.findByPk(currentUser.dbUserId);
                    if (dbUser) {
                        await room.addMember(dbUser);
                        // Update timestamp so it rises to top of history
                        room.changed('updatedAt', true);
                        await room.save();
                    }
                } catch (memberErr) {
                    console.error("Error adding member to room:", memberErr);
                }
            }

            if (created) {
                // Initialize default file
                await File.create({
                    roomId: roomId,
                    filename: 'main.py',
                    content: `print("Hello, collaborative world!")`
                });
            }

            // Fetch Files
            const dbFiles = await File.findAll({ where: { roomId } });
            const filesObj = {};
            dbFiles.forEach(f => {
                filesObj[f.filename] = f.content;
            });

            // Fetch Chat History (last 50 messages)
            const dbMessages = await Message.findAll({
                where: { roomId },
                order: [['createdAt', 'ASC']],
                limit: 50
            });
            const chatHistory = dbMessages.map(m => ({
                user: { username: m.username }, // minimal user obj for UI
                message: m.content,
                timestamp: m.createdAt
            }));

            // Send initial state to the new user
            socket.emit('initial-sync', {
                files: filesObj,
                participants: activeRooms[roomId].participants,
                currentUser: currentUser,
                chatHistory: chatHistory
            });

            // Notify others in the room
            socket.to(roomId).emit('user-joined', {
                user: currentUser
            });

        } catch (err) {
            console.error("Error joining room:", err);
            socket.emit('error', 'Failed to join room properly.');
        }
    });

    socket.on('file-add', async ({ path }) => {
        if (currentRoomId) {
            try {
                await File.create({
                    roomId: currentRoomId,
                    filename: path,
                    content: ''
                });
                io.to(currentRoomId).emit('file-add', { path });
            } catch (err) {
                console.error("Error adding file:", err);
            }
        }
    });

    socket.on('file-rename', async ({ oldPath, newPath }) => {
        if (currentRoomId) {
            try {
                const file = await File.findOne({ where: { roomId: currentRoomId, filename: oldPath } });
                if (file) {
                    file.filename = newPath;
                    await file.save();
                    io.to(currentRoomId).emit('file-rename', { oldPath, newPath });
                }
            } catch (err) {
                console.error("Error renaming file:", err);
            }
        }
    });

    socket.on('file-delete', async ({ path }) => {
        if (currentRoomId) {
            try {
                await File.destroy({ where: { roomId: currentRoomId, filename: path } });
                io.to(currentRoomId).emit('file-delete', { path });
            } catch (err) {
                console.error("Error deleting file:", err);
            }
        }
    });

    socket.on('code-change', async ({ path, newCode }) => {
        if (currentRoomId) {
            // Broadcast immediately for responsiveness
            socket.to(currentRoomId).emit('code-change', { path, newCode });

            // Debounce save to DB (or just save every time for simplicity in this MVP)
            // For production scaling, you'd want a redis cache or debounce mechanism here.
            try {
                const file = await File.findOne({ where: { roomId: currentRoomId, filename: path } });
                if (file) {
                    file.content = newCode;
                    await file.save();
                }
            } catch (err) {
                console.error("Error saving code change:", err);
            }
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

    socket.on('send-chat-message', async ({ message }) => {
        if (currentUser && currentRoomId) {
            // Save to DB
            try {
                await Message.create({
                    roomId: currentRoomId,
                    userId: currentUser.dbUserId || null,
                    username: currentUser.username,
                    content: message
                });
            } catch (err) {
                console.error("Error saving message:", err);
            }

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

    socket.on('ask-ai', async ({ message, context }) => {
        if (!currentUser) return;

        try {
            const prompt = `Code Context:\n${context || 'No code provided.'}\n\nUser Question: ${message}`;

            const response = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GOOGLE_API_KEY}`,
                {
                    contents: [{
                        parts: [{ text: prompt }]
                    }]
                }
            );

            const aiText = response.data.candidates[0].content.parts[0].text;

            // Send back to the specific user who asked
            socket.emit('ai-response', { message: aiText });

        } catch (error) {
            console.error('AI Error:', error.response?.data || error.message);
            socket.emit('ai-response', {
                message: "I'm sorry, I encountered an error processing your request. Please check the server logs or API key configuration."
            });
        }
    });

    // --- WebRTC Signaling ---
    const relaySignal = (event, payload) => {
        const { to } = payload;
        if (activeRooms[currentRoomId]?.participants[to]) {
            socket.to(to).emit(event, { ...payload,
                from: socket.id
            });
        }
    };

    socket.on('webrtc-offer', (payload) => relaySignal('webrtc-offer', payload));
    socket.on('webrtc-answer', (payload) => relaySignal('webrtc-answer', payload));
    socket.on('webrtc-ice-candidate', (payload) => relaySignal('webrtc-ice-candidate', payload));


    socket.on('disconnect', () => {
        if (currentRoomId && activeRooms[currentRoomId]?.participants[socket.id]) {
            delete activeRooms[currentRoomId].participants[socket.id];
            io.to(currentRoomId).emit('user-left', {
                userId: socket.id
            });
            // If the room is empty, we delete the active memory of it, but DB persists
            if (Object.keys(activeRooms[currentRoomId].participants).length === 0) {
                delete activeRooms[currentRoomId];
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Code Stream server running on port ${PORT}`);
});
