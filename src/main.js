
document.addEventListener('DOMContentLoaded', async () => {
    // Auth Check
    let currentUser = null;
    try {
        const res = await fetch('/auth/me');
        if (res.ok) {
            const data = await res.json();
            currentUser = data.user;
        }
    } catch (err) {
        console.error("Auth check failed", err);
    }

    // Redirect if not logged in
    if (!currentUser && window.location.pathname !== '/login.html' && window.location.pathname !== '/signup.html') {
        window.location.href = '/login.html';
        return;
    }

    // If we are on login/signup page and logged in, redirect to root
    if (currentUser && (window.location.pathname === '/login.html' || window.location.pathname === '/signup.html')) {
        window.location.href = '/';
        return;
    }

    // Only continue with editor logic if we are on the main app page
    if (!document.getElementById('app')) return;

    const socket = io();
    let state = {
        currentUser: currentUser,
        currentRoomId: null,
        username: currentUser ? currentUser.username : null,
        participants: {},
        files: {},
        openTabs: [],
        activeTab: null,
        editorInstance: null,
        webRTCPeers: {},
        localStream: null,
        screenStream: null,
        cameraTrack: null,
        isProgrammaticChange: false,
    };
    const ui = {
        entryModal: document.getElementById('entry-modal'),
        usernameInput: document.getElementById('username-input'),
        createRoomBtn: document.getElementById('create-room-btn'),
        roomIdInput: document.getElementById('room-id-input'),
        joinRoomBtn: document.getElementById('join-room-btn'),
        app: document.getElementById('app'),
        sidebar: document.getElementById('file-explorer-sidebar'),
        sidebarToggleBtn: document.getElementById('sidebar-toggle-btn'),
        sidebarOverlay: document.getElementById('sidebar-overlay'),
        fileExplorer: document.getElementById('file-explorer'),
        newFileBtn: document.getElementById('new-file-btn'),
        downloadZipBtn: document.getElementById('download-zip-btn'),
        // Activity Bar Elements
        activityFilesBtn: document.getElementById('activity-files-btn'),
        activityHistoryBtn: document.getElementById('activity-history-btn'),
        fileExplorerView: document.getElementById('file-explorer-view'),
        historyView: document.getElementById('history-view'),
        historyList: document.getElementById('history-list'),
        refreshHistoryBtn: document.getElementById('refresh-history-btn'),

        tabsContainer: document.getElementById('tabs-container'),
        editorPane: document.getElementById('editor-pane'),
        editorContainer: document.getElementById('editor-container'),
        rightPane: document.getElementById('right-pane'),
        resizer: document.getElementById('resizer'),
        bottomPaneTabs: document.getElementById('bottom-pane-tabs'),
        runCodeBtn: document.getElementById('run-code-btn'),
        terminal: document.getElementById('terminal'),
        stdinInput: document.getElementById('stdin-input'),
        chatMessages: document.getElementById('chat-messages'),
        chatInput: document.getElementById('chat-input'),
        participantList: document.getElementById('participant-list'),
        videoGrid: document.getElementById('video-grid'),
        videoStatus: document.getElementById('video-status'),
        toggleMicBtn: document.getElementById('toggle-mic-btn'),
        toggleCamBtn: document.getElementById('toggle-cam-btn'),
        shareScreenBtn: document.getElementById('share-screen-btn'),
        activityLog: document.getElementById('activity-log'),
        themeToggleBtn: document.getElementById('theme-toggle-btn'),
        themeIconSun: document.getElementById('theme-icon-sun'),
        themeIconMoon: document.getElementById('theme-icon-moon'),
        // AI UI Elements
        aiMessages: document.getElementById('ai-messages'),
        aiInput: document.getElementById('ai-input'),
        sendAiBtn: document.getElementById('send-ai-btn'),
    };

    // Pre-fill username if logged in
    if (state.currentUser && ui.usernameInput) {
        ui.usernameInput.value = state.currentUser.username;
        ui.usernameInput.disabled = true; // Don't allow changing username in temporary session if logged in
    }

    // --- NEW THEME LOGIC ---
    function applyTheme(theme) {
        if (theme === 'dark') {
            document.documentElement.classList.add('dark');
            document.documentElement.classList.remove('light');
            ui.themeIconSun.classList.remove('hidden');
            ui.themeIconMoon.classList.add('hidden');
            if (state.editorInstance) monaco.editor.setTheme('vs-dark');
        } else {
            document.documentElement.classList.add('light');
            document.documentElement.classList.remove('dark');
            ui.themeIconSun.classList.add('hidden');
            ui.themeIconMoon.classList.remove('hidden');
            if (state.editorInstance) monaco.editor.setTheme('vs');
        }
    }

    function toggleTheme() {
        const currentTheme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        localStorage.setItem('theme', newTheme);
        applyTheme(newTheme);
    }

    const logActivity = (message, iconType = 'info') => {
        const logEntry = document.createElement('div');
        const timestamp = new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
        });

        let iconHtml = '';
        if (iconType === 'Join') iconHtml = `<svg class="w-4 h-4 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"></path></svg>`;
        else if (iconType === 'Left') iconHtml = `<svg class="w-4 h-4 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"></path></svg>`;
        else if (iconType === 'Run') iconHtml = `<svg class="w-4 h-4 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`;
        else if (iconType === 'Paste') iconHtml = `<svg class="w-4 h-4 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path></svg>`;
        else if (iconType === 'Error') iconHtml = `<svg class="w-4 h-4 inline text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`;
        else iconHtml = `<svg class="w-4 h-4 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`;

        logEntry.innerHTML = `<span class="text-gray-500 dark:text-gray-400">${timestamp}</span> <span class="text-blue-400">${iconHtml}</span> <span>${message}</span>`;
        ui.activityLog.appendChild(logEntry);
        ui.activityLog.scrollTop = ui.activityLog.scrollHeight;
    };

    const init = () => {
        setupEventListeners();
        checkUrlForRoom();
        applyTheme(localStorage.getItem('theme') || 'dark'); // Apply saved theme on startup
    };

    const checkUrlForRoom = () => {
        const roomId = new URLSearchParams(window.location.search).get('room');
        if (roomId) ui.roomIdInput.value = roomId;
    };

    function setupEventListeners() {
        ui.createRoomBtn.addEventListener('click', () => handleJoinAttempt(true));
        ui.joinRoomBtn.addEventListener('click', () => handleJoinAttempt(false));
        ui.newFileBtn.addEventListener('click', addNewFile);
        ui.downloadZipBtn.addEventListener('click', downloadProjectAsZip);
        ui.runCodeBtn.addEventListener('click', runCode);
        ui.chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && ui.chatInput.value.trim() !== '') {
                socket.emit('send-chat-message', {
                    message: ui.chatInput.value.trim()
                });
                ui.chatInput.value = '';
            }
        });
        ui.toggleMicBtn.addEventListener('click', toggleMic);
        ui.toggleCamBtn.addEventListener('click', toggleCam);
        ui.shareScreenBtn.addEventListener('click', toggleScreenShare);
        ui.themeToggleBtn.addEventListener('click', toggleTheme);

        // AI Event Listeners
        ui.sendAiBtn.addEventListener('click', sendAiMessage);
        ui.aiInput.addEventListener('keypress', (e) => {
             if (e.key === 'Enter') sendAiMessage();
        });

        setupBottomPanelTabs();
        setupResizer();
        setupSidebarToggle();
        setupActivityBar();
    }

    const setupActivityBar = () => {
        const showFiles = () => {
            ui.fileExplorerView.classList.remove('hidden');
            ui.historyView.classList.add('hidden');
            ui.activityFilesBtn.classList.add('text-blue-500', 'dark:text-blue-400');
            ui.activityFilesBtn.classList.remove('text-gray-500', 'dark:text-gray-400');
            ui.activityHistoryBtn.classList.remove('text-blue-500', 'dark:text-blue-400');
            ui.activityHistoryBtn.classList.add('text-gray-500', 'dark:text-gray-400');
        };

        const showHistory = () => {
            ui.fileExplorerView.classList.add('hidden');
            ui.historyView.classList.remove('hidden');
            ui.activityFilesBtn.classList.remove('text-blue-500', 'dark:text-blue-400');
            ui.activityFilesBtn.classList.add('text-gray-500', 'dark:text-gray-400');
            ui.activityHistoryBtn.classList.add('text-blue-500', 'dark:text-blue-400');
            ui.activityHistoryBtn.classList.remove('text-gray-500', 'dark:text-gray-400');
            loadRoomHistory();
        };

        ui.activityFilesBtn.addEventListener('click', showFiles);
        ui.activityHistoryBtn.addEventListener('click', showHistory);
        ui.refreshHistoryBtn.addEventListener('click', loadRoomHistory);
    };

    async function loadRoomHistory() {
        if (!state.currentUser) {
             ui.historyList.innerHTML = '<div class="text-center text-gray-500 p-4">Please log in to view history.</div>';
             return;
        }

        ui.historyList.innerHTML = '<div class="text-center text-gray-500 p-4">Loading...</div>';

        try {
            const res = await fetch('/api/user/rooms');
            if (!res.ok) throw new Error('Failed to fetch history');
            const data = await res.json();

            if (data.rooms.length === 0) {
                 ui.historyList.innerHTML = '<div class="text-center text-gray-500 p-4">No recent chats found.</div>';
                 return;
            }

            ui.historyList.innerHTML = data.rooms.map(room => {
                const isActive = room.id === state.currentRoomId;
                const date = new Date(room.updatedAt).toLocaleDateString();
                return `
                <div class="flex flex-col p-2 rounded cursor-pointer ${isActive ? 'bg-blue-100 dark:bg-blue-900/30' : 'hover:bg-black/10 dark:hover:bg-white/10'}" onclick="window.location.href='/?room=${room.id}'">
                    <span class="font-medium text-gray-800 dark:text-gray-200 truncate">${room.name || room.id}</span>
                    <span class="text-xs text-gray-500 dark:text-gray-400">${date}</span>
                </div>`;
            }).join('');

        } catch (err) {
            console.error(err);
            ui.historyList.innerHTML = '<div class="text-center text-red-500 p-4">Error loading history.</div>';
        }
    }

    const setupSidebarToggle = () => {
        const toggle = () => {
            ui.sidebar.classList.toggle('-translate-x-full');
            ui.sidebarOverlay.classList.toggle('hidden');
        };
        ui.sidebarToggleBtn.addEventListener('click', toggle);
        ui.sidebarOverlay.addEventListener('click', toggle);
    };

    const setupBottomPanelTabs = () => ui.bottomPaneTabs.addEventListener('click', (e) => {
        if (e.target.matches('.bottom-tab')) {
            // Update active styles using direct classes instead of @apply
            ui.bottomPaneTabs.querySelectorAll('.bottom-tab').forEach(tab => {
                tab.classList.remove('bg-white', 'dark:bg-[#1e1e1e]', 'border-gray-200', 'dark:border-gray-700/50', 'text-blue-600', 'dark:text-white', 'border-b-0');
                tab.classList.add('text-gray-600', 'dark:text-gray-400', 'hover:bg-white', 'dark:hover:bg-[#333]');
            });

            e.target.classList.remove('text-gray-600', 'dark:text-gray-400', 'hover:bg-white', 'dark:hover:bg-[#333]');
            e.target.classList.add('bg-white', 'dark:bg-[#1e1e1e]', 'border-gray-200', 'dark:border-gray-700/50', 'text-blue-600', 'dark:text-white', 'border-b-0');

            // Show panel
            document.querySelectorAll('.bottom-panel').forEach(p => p.classList.add('hidden'));
            const panel = document.getElementById(e.target.dataset.panel);
            panel.classList.remove('hidden');
            if (['chat-panel', 'video-panel', 'terminal-panel', 'activity-panel', 'ai-panel'].includes(e.target.dataset.panel)) {
                panel.classList.add('flex', 'flex-col');
            }
        }
    });

    const setupResizer = () => {
        let isResizing = false;
        ui.resizer.addEventListener('mousedown', () => {
            isResizing = true;
            document.body.style.cursor = 'ew-resize';
            document.body.style.userSelect = 'none';
        });
        document.addEventListener('mousemove', (e) => {
            if (isResizing) {
                const totalWidth = window.innerWidth;
                const newLeftWidthPercent = (e.clientX / totalWidth) * 100;
                if (newLeftWidthPercent > 20 && newLeftWidthPercent < 80) {
                    ui.editorPane.style.width = `${newLeftWidthPercent}%`;
                    ui.rightPane.style.width = `${100 - newLeftWidthPercent}%`;
                }
            }
        });
        document.addEventListener('mouseup', () => {
            isResizing = false;
            document.body.style.cursor = 'default';
            document.body.style.userSelect = 'auto';
        });
    };

    async function handleJoinAttempt(isCreating) {
        const username = ui.usernameInput.value.trim();
        if (!username) return alert('Please enter your name.');
        const roomId = isCreating ? `cs-${Math.random().toString(36).substr(2, 9)}` : ui.roomIdInput.value.trim();
        if (!roomId) return alert('Please enter a Room ID.');
        await initializeMedia();
        state.username = username;
        state.currentRoomId = roomId;
        ui.entryModal.classList.add('hidden');
        ui.app.classList.remove('hidden');
        ui.app.classList.add('flex');
        window.history.pushState(null, '', `?room=${roomId}`);

        // Pass userId if authenticated
        if (socket.connected) socket.emit('join-room', {
            roomId: state.currentRoomId,
            username: state.username,
            userId: state.currentUser ? state.currentUser.id : null
        });

        // Set initial active tab styling manually since we removed the @apply block
        const terminalTab = ui.bottomPaneTabs.querySelector('[data-panel="terminal-panel"]');
        if (terminalTab) {
             terminalTab.classList.remove('text-gray-600', 'dark:text-gray-400', 'hover:bg-white', 'dark:hover:bg-[#333]');
             terminalTab.classList.add('bg-white', 'dark:bg-[#1e1e1e]', 'border-gray-200', 'dark:border-gray-700/50', 'text-blue-600', 'dark:text-white', 'border-b-0');
        }
    }

    const renderFileExplorer = () => {
        ui.fileExplorer.innerHTML = Object.keys(state.files).sort().map(path =>
            `<div class="flex justify-between items-center group p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer" data-path="${path}">
                <span class="file-name text-gray-700 dark:text-gray-300 group-hover:text-black dark:group-hover:text-white">${path}</span>
                <div class="hidden group-hover:flex items-center">
                    <button class="rename-file-btn text-xs text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white mr-1" data-path="${path}" title="Rename">Edit</button>
                    <button class="delete-file-btn text-xs text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white" data-path="${path}" title="Delete">Del</button>
                </div>
            </div>`
        ).join('');
        ui.fileExplorer.querySelectorAll('[data-path]').forEach(el => el.addEventListener('click', (e) => !e.target.closest('button') && openTab(el.dataset.path)));
        ui.fileExplorer.querySelectorAll('.rename-file-btn').forEach(btn => btn.addEventListener('click', renameFile));
        ui.fileExplorer.querySelectorAll('.delete-file-btn').forEach(btn => btn.addEventListener('click', deleteFile));
    };

    const renderParticipants = () => {
        const participants = Object.values(state.participants);
        const avatar = (p) => `<div class="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-sm font-bold" style="background-color: ${p.color}; color: #fff;">${p.username.charAt(0).toUpperCase()}</div>`;
        ui.participantList.innerHTML = participants.map(p =>
            `<div class="flex items-center space-x-3 p-2 rounded-md hover:bg-black/5 dark:hover:bg-white/5">
                ${avatar(p)}
                <span class="font-medium">${p.username} ${p.id === state.currentUser?.id ? '<span class="text-xs text-blue-400">(You)</span>' : ''}</span>
            </div>`
        ).join('');
    };

    const renderTabs = () => {
        ui.tabsContainer.innerHTML = state.openTabs.map(path =>
            `<div class="tab flex items-center px-4 py-2 border-r border-gray-300 dark:border-gray-700/50 cursor-pointer ${path === state.activeTab ? 'bg-white dark:bg-[#1e1e1e]' : 'bg-transparent hover:bg-gray-100 dark:hover:bg-[#333]'}" data-path="${path}">
                <span class="text-sm font-medium">${path}</span>
                <button class="close-tab-btn ml-3 text-gray-500 hover:text-black dark:hover:text-white" data-path="${path}">×</button>
            </div>`
        ).join('');
        ui.tabsContainer.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', (e) => !e.target.classList.contains('close-tab-btn') && switchTab(tab.dataset.path)));
        ui.tabsContainer.querySelectorAll('.close-tab-btn').forEach(btn => btn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeTab(btn.dataset.path);
        }));
    };

    const addNewFile = () => {
        const path = prompt("Enter new file name:");
        if (path && !state.files[path]) {
            socket.emit('file-add', {
                path
            });
        } else if (state.files[path]) {
            alert('A file with that name already exists.');
        }
    };

    const renameFile = (e) => {
        const oldPath = e.target.dataset.path;
        const newPath = prompt("Enter new file name:", oldPath);
        if (newPath && newPath !== oldPath && !state.files[newPath]) {
            socket.emit('file-rename', {
                oldPath,
                newPath
            });
        } else if (state.files[newPath]) {
            alert('A file with that name already exists.');
        }
    };

    const deleteFile = (e) => {
        const path = e.target.dataset.path;
        if (confirm(`Delete ${path}?`)) {
            socket.emit('file-delete', {
                path
            });
        }
    };

    const openTab = (path) => {
        if (!state.openTabs.includes(path)) {
            state.openTabs.push(path);
        }
        switchTab(path);
    };

    const closeTab = (path) => {
        state.openTabs = state.openTabs.filter(t => t !== path);
        if (state.activeTab === path) {
            state.activeTab = state.openTabs[0] || null;
            updateEditorContent(state.activeTab);
        }
        renderTabs();
    };

    const switchTab = (path) => {
        state.activeTab = path;
        renderTabs();
        updateEditorContent(path);
    };

    function initializeEditor() {
        if (state.editorInstance) return;
        const editorDiv = document.getElementById('editor');
        require.config({
            paths: {
                'vs': 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs'
            }
        });
        require(['vs/editor/editor.main'], function() {
            state.editorInstance = monaco.editor.create(editorDiv, {
                value: "// Welcome!",
                language: 'javascript',
                theme: localStorage.getItem('theme') === 'light' ? 'vs' : 'vs-dark',
                automaticLayout: true,
                fontSize: 14,
            });
            state.editorInstance.onDidChangeModelContent(e => {
                if (state.isProgrammaticChange) return;
                const newCode = state.editorInstance.getValue();
                state.files[state.activeTab] = newCode;
                const PASTE_THRESHOLD = 50;
                const isPaste = e.changes.length === 1 && e.changes[0].text.length > PASTE_THRESHOLD;
                if (isPaste) socket.emit('large-paste');
                socket.emit('code-change', {
                    path: state.activeTab,
                    newCode: newCode
                });
            });
            const firstFile = Object.keys(state.files)[0];
            if (firstFile) openTab(firstFile);
        });
    }

    const getLanguageFromPath = (path) => {
        const ext = path?.split('.').pop() || '';
        return {
            'js': 'javascript',
            'py': 'python',
            'java': 'java',
            'c': 'c',
            'cpp': 'cpp',
            'html': 'html',
            'css': 'css'
        }[ext] || 'plaintext';
    };

    const updateEditorContent = (path) => {
        if (!state.editorInstance) return;
        if (!path) {
            state.editorInstance.setValue('');
            return;
        }
        const model = state.editorInstance.getModel();
        state.isProgrammaticChange = true;
        model.setValue(state.files[path] || '');
        monaco.editor.setModelLanguage(model, getLanguageFromPath(path));
        state.isProgrammaticChange = false;
    };

    const runCode = () => {
        if (!state.activeTab) return alert('Open a file to run.');
        const lang = {
            'js': 'javascript',
            'py': 'python',
            'java': 'java',
            'c': 'c',
            'cpp': 'cpp'
        }[state.activeTab.split('.').pop()];
        if (!lang) return alert(`Execution for .${state.activeTab.split('.').pop()} files is not supported.`);
        ui.terminal.innerHTML += `<span class="text-blue-400">> Executing ${state.activeTab}...</span>\n`;
        socket.emit('run-code', {
            language: lang,
            code: state.editorInstance.getValue(),
            currentFile: state.activeTab,
            stdin: ui.stdinInput.value
        });
    };

    // --- AI LOGIC ---
    const sendAiMessage = () => {
        const message = ui.aiInput.value.trim();
        if (!message) return;

        const contextCode = state.editorInstance ? state.editorInstance.getValue() : '';

        // Add user message to UI
        const userMsgDiv = document.createElement('div');
        userMsgDiv.className = 'text-right my-2';
        userMsgDiv.innerHTML = `<span class="bg-blue-600 text-white px-3 py-1 rounded-lg inline-block">${message}</span>`;
        ui.aiMessages.appendChild(userMsgDiv);
        ui.aiMessages.scrollTop = ui.aiMessages.scrollHeight;

        ui.aiInput.value = '';

        // Add loading indicator
        const loadingDiv = document.createElement('div');
        loadingDiv.id = 'ai-loading';
        loadingDiv.className = 'text-left my-2';
        loadingDiv.innerHTML = `<span class="bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-3 py-1 rounded-lg inline-block italic">Thinking...</span>`;
        ui.aiMessages.appendChild(loadingDiv);
        ui.aiMessages.scrollTop = ui.aiMessages.scrollHeight;

        socket.emit('ask-ai', { message, context: contextCode });
    };

    socket.on('ai-response', ({ message }) => {
        const loadingDiv = document.getElementById('ai-loading');
        if (loadingDiv) loadingDiv.remove();

        const aiMsgDiv = document.createElement('div');
        aiMsgDiv.className = 'text-left my-2';
        // Simple markdown parsing for code blocks could be added here,
        // for now we just use whitespace-pre-wrap style in CSS if needed,
        // or just standard text.
        aiMsgDiv.innerHTML = `<span class="bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-3 py-1 rounded-lg inline-block whitespace-pre-wrap">${message}</span>`;
        ui.aiMessages.appendChild(aiMsgDiv);
        ui.aiMessages.scrollTop = ui.aiMessages.scrollHeight;
    });
    // ----------------

    const downloadProjectAsZip = () => {
        const zip = new JSZip();
        Object.keys(state.files).forEach(path => zip.file(path, state.files[path]));
        zip.generateAsync({
            type: "blob"
        }).then(content => {
            const link = document.createElement('a');
            link.href = URL.createObjectURL(content);
            link.download = `code-stream-${state.currentRoomId}.zip`;
            link.click();
        });
    };

    async function initializeMedia() {
        try {
            ui.videoStatus.textContent = "Initializing camera...";
            state.localStream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true
            });
            console.log("Local stream acquired.");
            state.cameraTrack = state.localStream.getVideoTracks()[0];
            const localVideo = document.createElement('video');
            localVideo.srcObject = state.localStream;
            localVideo.autoplay = true;
            localVideo.muted = true;
            localVideo.className = 'w-full h-auto bg-black rounded';
            ui.videoGrid.prepend(localVideo);
            ui.videoStatus.textContent = "Waiting for other participants...";
            return state.localStream;
        } catch (error) {
            console.error("Could not get user media", error);
            ui.videoStatus.textContent = "Camera/Mic access denied. Video chat is disabled.";
            logActivity("Camera/Mic access denied.", 'Error');
            return null;
        }
    }

    const toggleMic = () => {
        if (!state.localStream) return;
        const enabled = !state.localStream.getAudioTracks()[0].enabled;
        state.localStream.getAudioTracks()[0].enabled = enabled;
        ui.toggleMicBtn.classList.toggle('bg-red-600', !enabled);
        ui.toggleMicBtn.classList.toggle('bg-gray-600', enabled);
    };

    const toggleCam = () => {
        if (!state.cameraTrack) return;
        const enabled = !state.cameraTrack.enabled;
        state.cameraTrack.enabled = enabled;
        ui.toggleCamBtn.classList.toggle('bg-red-600', !enabled);
        ui.toggleCamBtn.classList.toggle('bg-gray-600', enabled);
    };

    async function toggleScreenShare() {
        if (state.screenStream) {
            await stopScreenShare();
        } else {
            try {
                state.screenStream = await navigator.mediaDevices.getDisplayMedia({
                    video: true
                });
                const screenTrack = state.screenStream.getVideoTracks()[0];
                await replaceTrackForAllPeers(screenTrack);
                ui.shareScreenBtn.classList.add('bg-blue-600');
                screenTrack.onended = () => stopScreenShare();
            } catch (err) {
                console.error("Screen share error:", err);
                logActivity("Could not start screen share.", 'Screen');
            }
        }
    }

    async function stopScreenShare() {
        if (!state.cameraTrack) return;
        await replaceTrackForAllPeers(state.cameraTrack);
        state.screenStream.getTracks().forEach(track => track.stop());
        state.screenStream = null;
        ui.shareScreenBtn.classList.remove('bg-blue-600');
    };

    const replaceTrackForAllPeers = async (newTrack) => {
        for (const peerId in state.webRTCPeers) {
            const sender = state.webRTCPeers[peerId].getSenders().find(s => s.track?.kind === 'video');
            if (sender) await sender.replaceTrack(newTrack);
        }
    };

    const createPeerConnection = (remoteUserId) => {
        console.log(`Creating peer connection to ${remoteUserId}`);
        const pc = new RTCPeerConnection({
            iceServers: [{
                urls: 'stun:stun.l.google.com:19302'
            }]
        });
        pc.onicecandidate = e => e.candidate && socket.emit('webrtc-ice-candidate', {
            to: remoteUserId,
            candidate: e.candidate
        });
        pc.ontrack = e => {
            console.log(`Received track from ${remoteUserId}`);
            let videoContainer = document.getElementById(`video-container-${remoteUserId}`);
            if (!videoContainer) {
                videoContainer = document.createElement('div');
                videoContainer.id = `video-container-${remoteUserId}`;
                videoContainer.className = 'relative';
                videoContainer.innerHTML = `<video id="video-${remoteUserId}" autoplay class="w-full h-auto bg-black rounded"></video>`;
                ui.videoGrid.appendChild(videoContainer);
                ui.videoStatus.textContent = "";
            }
            document.getElementById(`video-${remoteUserId}`).srcObject = e.streams[0];
        };
        state.localStream?.getTracks().forEach(track => pc.addTrack(track, state.localStream));
        state.webRTCPeers[remoteUserId] = pc;
        return pc;
    };

    socket.on('connect', () => {
        if (state.currentRoomId && state.username) socket.emit('join-room', {
            roomId: state.currentRoomId,
            username: state.username,
            userId: state.currentUser ? state.currentUser.id : null
        });
    });

    socket.on('initial-sync', (data) => {
        const isFirstSync = !state.editorInstance;
        // Merge data, but handle chat history separately if needed or just replace
        Object.assign(state, data);
        renderFileExplorer();
        renderParticipants();

        // Render Chat History
        if (data.chatHistory) {
             ui.chatMessages.innerHTML = '';
             data.chatHistory.forEach(msg => {
                 const messageEl = document.createElement('div');
                 const color = msg.user.color || '#3b82f6'; // fallback color
                 messageEl.innerHTML = `<div><b style="color:${color};">${msg.user.username}:</b> <span class="text-gray-700 dark:text-gray-300">${msg.message}</span></div>`;
                 ui.chatMessages.appendChild(messageEl);
             });
             ui.chatMessages.scrollTop = ui.chatMessages.scrollHeight;
        }

        if (isFirstSync) initializeEditor();
    });

    socket.on('user-joined', ({
        user
    }) => {
        state.participants[user.id] = user;
        renderParticipants();
        logActivity(`${user.username} has joined.`, 'Join');
        if (state.localStream) {
            const pc = createPeerConnection(user.id);
            pc.createOffer().then(offer => {
                pc.setLocalDescription(offer);
                socket.emit('webrtc-offer', {
                    to: user.id,
                    offer
                });
            });
        }
    });

    socket.on('user-left', ({
        userId
    }) => {
        const user = state.participants[userId];
        if (user) logActivity(`${user.username} has left.`, 'Left');
        delete state.participants[userId];
        renderParticipants();
        state.webRTCPeers[userId]?.close();
        delete state.webRTCPeers[userId];
        document.getElementById(`video-container-${userId}`)?.remove();
        if (Object.keys(state.participants).length <= 1) ui.videoStatus.textContent = "Waiting for other participants...";
    });

    socket.on('file-add', ({
        path
    }) => {
        state.files[path] = '';
        renderFileExplorer();
    });

    socket.on('file-rename', ({
        oldPath,
        newPath
    }) => {
        state.files[newPath] = state.files[oldPath];
        delete state.files[oldPath];
        const tabIndex = state.openTabs.indexOf(oldPath);
        if (tabIndex > -1) state.openTabs[tabIndex] = newPath;
        if (state.activeTab === oldPath) state.activeTab = newPath;
        renderFileExplorer();
        renderTabs();
    });

    socket.on('file-delete', ({
        path
    }) => {
        delete state.files[path];
        if (state.activeTab === path) {
            closeTab(path);
        } else {
            state.openTabs = state.openTabs.filter(t => t !== path);
            renderTabs();
        }
        renderFileExplorer();
    });

    socket.on('code-change', ({
        path,
        newCode
    }) => {
        state.files[path] = newCode;
        if (path === state.activeTab && state.editorInstance) {
            const model = state.editorInstance.getModel();
            if (model.getValue() !== newCode) {
                const currentPosition = state.editorInstance.getPosition();
                state.isProgrammaticChange = true;
                model.setValue(newCode);
                if (currentPosition) {
                    state.editorInstance.setPosition(currentPosition);
                }
                state.isProgrammaticChange = false;
            }
        }
    });

    socket.on('code-output', ({
        stdout,
        stderr,
        status
    }) => {
        let outputHTML = '';
        if (stderr) outputHTML += `<span class="text-orange-400">${stderr.replace(/\n/g, '<br>')}</span>`;
        else if (stdout) outputHTML += `<span class="text-green-400 dark:text-gray-300">Output:\n${stdout.replace(/\n/g, '<br>')}</span>`;
        else outputHTML += `<span class="text-gray-500">Execution finished with status: ${status}</span>`;
        ui.terminal.innerHTML += outputHTML + '\n';
        ui.terminal.scrollTop = ui.terminal.scrollHeight;
    });

    socket.on('execution-notification', ({
        username,
        file
    }) => logActivity(`${username} ran ${file}`, 'Run'));

    socket.on('paste-notification', ({
        username
    }) => logActivity(`${username} pasted a large block of code.`, 'Paste'));

    socket.on('receive-chat-message', ({
        user,
        message
    }) => {
        const messageEl = document.createElement('div');
        messageEl.innerHTML = `<div><b style="color:${user.color};">${user.username}:</b> <span class="text-gray-700 dark:text-gray-300">${message}</span></div>`;
        ui.chatMessages.appendChild(messageEl);
        ui.chatMessages.scrollTop = ui.chatMessages.scrollHeight;
    });

    socket.on('webrtc-offer', async ({
        from,
        offer
    }) => {
        const pc = createPeerConnection(from);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('webrtc-answer', {
            to: from,
            answer
        });
    });

    socket.on('webrtc-answer', ({
        from,
        answer
    }) => state.webRTCPeers[from]?.setRemoteDescription(new RTCSessionDescription(answer)));

    socket.on('webrtc-ice-candidate', ({
        from,
        candidate
    }) => state.webRTCPeers[from]?.addIceCandidate(new RTCIceCandidate(candidate)));

    init();
});
