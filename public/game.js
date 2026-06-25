const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let myUsername = "";
let currentRoomId = null;
let mySlot = null;
let roomData = null;
let gameState = 'lobby';

// Tải tài nguyên hình ảnh
const imgIdle = new Image(); imgIdle.src = 'assets/cat_idle.png';
const imgRun = new Image(); imgRun.src = 'assets/cat1.png';
const imgLine = new Image(); imgLine.src = 'assets/day.png';
const imgTicket = new Image(); imgTicket.src = 'assets/pass_ticket.png';
const imgMonster = new Image(); imgMonster.src = 'assets/monster.png';

// Thực thể game định vị theo tọa độ cố định 850x400 (Sẽ được scale tự động theo màn hình)
const V_WIDTH = 850;
const V_HEIGHT = 400;
const FLOOR_Y = 320; // Sàn cố định cố định tại đây

let players = { slot1: null, slot2: null };
let monsters = [];
let ticket = { x: -100, y: -100, spawned: false, pickedUp: false };
let portal = { x: 740, y: FLOOR_Y - 80, width: 60, height: 80, open: false };
let gameLevel = 1;

// Cấu hình phím bấm ảo
const buttons = {
    left:   { x: 30,  y: 310, w: 60, h: 60, label: "◀", pressed: false },
    right:  { x: 110, y: 310, w: 60, h: 60, label: "▶", pressed: false },
    jump:   { x: 670, y: 310, w: 60, h: 60, label: "▲", pressed: false },
    action: { x: 750, y: 310, w: 70, h: 60, label: "ATK", pressed: false }
};

// Hàm xử lý co giãn màn hình (Chống lệch sàn trên mọi loại điện thoại)
function resizeCanvas() {
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    
    // Giữ nguyên tỷ lệ 850:400 lý tưởng
    let scale = Math.min(windowWidth / V_WIDTH, windowHeight / V_HEIGHT);
    
    canvas.style.width = (V_WIDTH * scale) + 'px';
    canvas.style.height = (V_HEIGHT * scale) + 'px';
}
window.addEventListener('resize', resizeCanvas);
window.addEventListener('orientationchange', () => { setTimeout(resizeCanvas, 200); });

function login() {
    myUsername = document.getElementById('username').value.trim();
    if(!myUsername) return alert("Nhập tên vô nè!");
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('lobby-screen').style.display = 'flex';
    document.getElementById('welcome-text').innerText = `Chào ${myUsername} 🐯`;
    try { document.documentElement.requestFullscreen(); } catch(e){}
    resizeCanvas();
}
function createRoom() { socket.emit('createRoom', myUsername); }
function joinRoom() {
    let rId = document.getElementById('room-id-input').value.trim();
    if(!rId) return alert("Nhập ID phòng vào chứ!");
    socket.emit('joinRoom', { roomId: rId, username: myUsername });
}
function startGame() { socket.emit('startGame', currentRoomId); }

socket.on('roomCreated', (data) => setupRoomUI(data));
socket.on('joinSuccess', (data) => setupRoomUI(data));
socket.on('roomUpdated', (data) => {
    roomData = data;
    document.getElementById('slot1-name').innerText = data.players.slot1?.name || "Trống";
    document.getElementById('slot2-name').innerText = data.players.slot2?.name || "Trống";
    if (data.players.slot1 && data.players.slot2 && mySlot === 'slot1') {
        document.getElementById('start-btn').style.display = 'block';
        document.getElementById('wait-msg').style.display = 'none';
    }
});
socket.on('gameStarted', () => {
    document.getElementById('room-screen').style.display = 'none';
    canvas.style.display = 'block';
    gameState = 'playing';
    resizeCanvas();
    initGameWorld();
    gameLoop();
});
socket.on('peerUpdate', ({ slot, playerData }) => {
    if(players[slot]) players[slot] = { ...players[slot], ...playerData };
});
socket.on('levelUp', (data) => {
    gameLevel = data.level;
    initGameWorld();
});
socket.on('errorMsg', (msg) => alert(msg));
socket.on('playerLeft', () => {
    alert("Người yêu đã rời phòng mất rồi 😿!");
    location.reload();
});

function setupRoomUI(data) {
    currentRoomId = data.roomId;
    mySlot = data.slot;
    roomData = data.roomData;
    document.getElementById('lobby-screen').style.display = 'none';
    document.getElementById('room-screen').style.display = 'flex';
    document.getElementById('display-room-id').innerText = currentRoomId;
    document.getElementById('slot1-name').innerText = roomData.players.slot1?.name || "Trống";
    document.getElementById('slot2-name').innerText = roomData.players.slot2?.name || "Trống";
    if(mySlot === 'slot2') buttons.action.label = "OPEN";
}

function initGameWorld() {
    players.slot1 = { x: 150, y: FLOOR_Y - 32, vx: 0, vy: 0, state: 'idle', frame: 0, animTick: 0, dir: 1, isGrounded: true, width: 32, height: 32 };
    players.slot2 = { x: 100, y: FLOOR_Y - 32, vx: 0, vy: 0, state: 'idle', frame: 0, animTick: 0, dir: 1, isGrounded: true, width: 32, height: 32 };
    
    let mHp = Math.round(30 * Math.pow(1.3, gameLevel - 1));
    monsters = [
        { x: 400, y: FLOOR_Y - 32, vx: -1, hp: mHp, maxHp: mHp, width: 32, height: 32, dir: -1 },
        { x: 580, y: FLOOR_Y - 32, vx: 1, hp: mHp, maxHp: mHp, width: 32, height: 32, dir: 1 }
    ];
    ticket.spawned = false; ticket.pickedUp = false;
    portal.open = false;
}

// Xử lý Touch di động chuẩn hóa tọa độ theo scale thực tế
function getTouchPos(touch) {
    let rect = canvas.getBoundingClientRect();
    // Tính toán tỷ lệ chuẩn giữa kích thước hiển thị CSS và kích thước Canvas gốc
    let scaleX = V_WIDTH / rect.width;
    let scaleY = V_HEIGHT / rect.height;
    return {
        x: (touch.clientX - rect.left) * scaleX,
        y: (touch.clientY - rect.top) * scaleY
    };
}

window.addEventListener('touchstart', (e) => {
    if(gameState !== 'playing') return;
    for (let touch of e.touches) {
        let pos = getTouchPos(touch);
        for (let b in buttons) {
            let btn = buttons[b];
            if (pos.x >= btn.x && pos.x <= btn.x + btn.w && pos.y >= btn.y && pos.y <= btn.y + btn.h) {
                btn.pressed = true;
                if(b === 'action') performAction();
            }
        }
    }
}, {passive: false});

window.addEventListener('touchend', (e) => {
    if(gameState !== 'playing') return;
    for (let b in buttons) buttons[b].pressed = false;
    for (let touch of e.touches) {
        let pos = getTouchPos(touch);
        for (let b in buttons) {
            let btn = buttons[b];
            if (pos.x >= btn.x && pos.x <= btn.x + btn.w && pos.y >= btn.y && pos.y <= btn.y + btn.h) {
                btn.pressed = true;
            }
        }
    }
});

function performAction() {
    let me = players[mySlot];
    if (mySlot === 'slot1') {
        me.state = 'attack';
        monsters.forEach(m => {
            let dist = Math.abs((me.x + 16) - (m.x + 16));
            if(dist < 50) {
                let myDmg = Math.round(10 * Math.pow(1.5, gameLevel - 1));
                m.hp -= myDmg;
            }
        });
        let aliveMonsters = monsters.filter(m => m.hp > 0);
        if(aliveMonsters.length < monsters.length && !ticket.spawned) {
            ticket.spawned = true;
            ticket.x = 450; ticket.y = FLOOR_Y - 25;
        }
        monsters = aliveMonsters;
    } else {
        if (ticket.pickedUp && Math.abs(me.x - portal.x) < 60) {
            portal.open = true;
        }
    }
}

function update() {
    let me = players[mySlot];
    if(!me) return;

    if (buttons.left.pressed) {
        me.vx = -3; me.dir = -1; me.state = 'run';
    } else if (buttons.right.pressed) {
        me.vx = 3; me.dir = 1; me.state = 'run';
    } else {
        me.vx = 0; if(me.state !== 'attack') me.state = 'idle';
    }

    if (buttons.jump.pressed && me.isGrounded) {
        me.vy = -10; me.isGrounded = false;
    }

    me.vy += 0.5;
    me.x += me.vx; me.y += me.vy;

    // Khóa chặt chân mèo trên sàn cố định FLOOR_Y
    if(me.y >= FLOOR_Y - 32) {
        me.y = FLOOR_Y - 32;
        me.vy = 0;
        me.isGrounded = true;
    }
    if(me.x < 0) me.x = 0; if(me.x > V_WIDTH - me.width) me.x = V_WIDTH - me.width;

    if (mySlot === 'slot2' && ticket.spawned && !ticket.pickedUp) {
        if(Math.abs(me.x - ticket.x) < 30) ticket.pickedUp = true;
    }

    if (portal.open && players.slot1.x > 700 && players.slot2.x > 700) {
        if(mySlot === 'slot1') socket.emit('nextLevel', currentRoomId);
    }

    // Tính toán hoạt họa chuyển đổi Frame theo lưới ảnh (Grid Spriteheet)
    me.animTick++;
    if (me.state === 'run') {
        if(me.animTick % 6 === 0) me.frame = (me.frame + 1) % 8; // Chạy tuần hoàn 8 khung hình
    } else if (me.state === 'idle') {
        if(me.animTick % 12 === 0) me.frame = (me.frame + 1) % 3; // Đứng yên tuần hoàn 3 khung hình
    }

    monsters.forEach(m => {
        m.x += m.vx;
        if(m.x < 300 || m.x > 700) { m.vx *= -1; m.dir = m.vx > 0 ? 1 : -1; }
    });

    socket.emit('playerUpdate', {
        roomId: currentRoomId,
        slot: mySlot,
        playerData: { x: me.x, y: me.y, state: me.state, frame: me.frame, dir: me.dir }
    });
}

function draw() {
    ctx.clearRect(0, 0, V_WIDTH, V_HEIGHT);

    // 1. Vẽ nền trời và Sàn cố định
    ctx.fillStyle = '#87CEEB'; ctx.fillRect(0, 0, V_WIDTH, V_HEIGHT);
    ctx.fillStyle = '#228B22'; ctx.fillRect(0, FLOOR_Y, V_WIDTH, V_HEIGHT - FLOOR_Y);

    // 2. Vẽ Sợi Dây Nối Trái Tim (Cắt theo lưới 2x2 của dây)
    if (players.slot1 && players.slot2) {
        let midX = (players.slot1.x + players.slot2.x) / 2 + 16;
        let midY = (players.slot1.y + players.slot2.y) / 2 + 16;
        
        ctx.beginPath(); ctx.strokeStyle = "#ffb6c1"; ctx.lineWidth = 3;
        ctx.moveTo(players.slot1.x + 16, players.slot1.y + 16);
        ctx.lineTo(players.slot2.x + 16, players.slot2.y + 16); ctx.stroke();
        
        try {
            // Lấy cụm trái tim nhỏ đầu tiên từ góc trên trái lưới của day.png
            let singleW = imgLine.width / 2;
            let singleH = imgLine.height / 2;
            ctx.drawImage(imgLine, 0, 0, singleW, singleH, midX - 16, midY - 16, 32, 32);
        } catch(e){}
    }

    // 3. Vẽ Cánh Cổng Vượt Ải
    ctx.fillStyle = portal.open ? '#7fff00' : '#8b4513';
    ctx.fillRect(portal.x, portal.y, portal.width, portal.height);
    ctx.fillStyle = '#fff'; ctx.font = '12px Arial';
    ctx.fillText(portal.open ? "CỔNG MỞ" : "CỔNG KHÓA", portal.x + 2, portal.y - 10);

    // 4. Vẽ Giấy thông hành
    if (ticket.spawned && !ticket.pickedUp) {
        try { ctx.drawImage(imgTicket, ticket.x, ticket.y, 25, 25); } catch(e){
            ctx.fillStyle = 'white'; ctx.fillRect(ticket.x, ticket.y, 20, 20);
        }
    }

    // 5. Vẽ Quái vật
    monsters.forEach(m => {
        try { ctx.drawImage(imgMonster, m.x, m.y, m.width, m.height); } catch(e){
            ctx.fillStyle = 'red'; ctx.fillRect(m.x, m.y, m.width, m.height);
        }
        ctx.fillStyle = 'black'; ctx.fillRect(m.x, m.y - 10, m.width, 4);
        ctx.fillStyle = 'red'; ctx.fillRect(m.x, m.y - 10, m.width * (m.hp / m.maxHp), 4);
    });

    // 6. Vẽ 2 Con Mèo (Thuật toán cắt hình theo lưới Grid)
    for (let slot in players) {
        let p = players[slot];
        if (!p) continue;

        let sheet = p.state === 'run' ? imgRun : imgIdle;
        let cols = p.state === 'run' ? 3 : 2; // Cột của cat1 là 3, cat_idle là 2
        
        let frameW = sheet.width / cols;
        let frameH = sheet.height / 3; // Cả hai ảnh đều có 3 dòng hàng dọc
        
        // Tính vị trí cột (col) và hàng (row) dựa trên chỉ số frame hiện tại
        let col = p.frame % cols;
        let row = Math.floor(p.frame / cols);

        ctx.save();
        if(p.dir === -1) {
            ctx.translate(p.x + 16, p.y + 16); ctx.scale(-1, 1); ctx.translate(-(p.x + 16), -(p.y + 16));
        }
        try {
            ctx.drawImage(sheet, col * frameW, row * frameH, frameW, frameH, p.x, p.y, 32, 32);
        } catch(e) {
            ctx.fillStyle = slot === 'slot1' ? 'blue' : 'pink'; ctx.fillRect(p.x, p.y, 32, 32);
        }
        ctx.restore();

        ctx.fillStyle = 'black'; ctx.font = 'bold 12px Arial';
        ctx.fillText((slot === 'slot1' ? "⚔️ " : "📜 ") + (roomData?.players[slot]?.name || "Mèo"), p.x - 5, p.y - 8);
    }

    // 7. Giao diện HUD công cụ
    ctx.fillStyle = '#ff1493'; ctx.font = 'bold 20px Arial';
    ctx.fillText(`ẢI HIỆN TẠI: ${gameLevel}`, 20, 35);
    if(ticket.pickedUp) {
        ctx.fillStyle = '#006400'; ctx.font = '14px Arial';
        ctx.fillText("✨ Đã nhặt giấy thông hành! Chạy tới cổng thôi người iu ơi!", 20, 60);
    }

    // 8. Vẽ nút bấm cảm ứng cố định vị trí HUD
    for (let b in buttons) {
        let btn = buttons[b];
        ctx.fillStyle = btn.pressed ? 'rgba(255,105,180,0.8)' : 'rgba(255,255,255,0.4)';
        ctx.strokeStyle = 'rgba(255,105,180,0.6)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.roundRect(btn.x, btn.y, btn.w, btn.h, 15); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#ff69b4'; ctx.font = 'bold 20px Arial';
        ctx.fillText(btn.label, btn.x + (btn.w/2) - 10, btn.y + (btn.h/2) + 7);
    }
}

function gameLoop() {
    if (gameState !== 'playing') return;
    update();
    draw();
    requestAnimationFrame(gameLoop);
}
