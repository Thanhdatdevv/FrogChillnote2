const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let myUsername = "";
let currentRoomId = null;
let mySlot = null; // 'slot1' hoặc 'slot2'
let roomData = null;
let gameState = 'lobby'; // lobby, room, playing

// Tải tài nguyên hình ảnh (Tự động map với các file bạn gửi)
const imgIdle = new Image(); imgIdle.src = 'assets/cat_idle.png';
const imgRun = new Image(); imgRun.src = 'assets/cat1.png';
const imgLine = new Image(); imgLine.src = 'assets/day.png';
const imgTicket = new Image(); imgTicket.src = 'assets/pass_ticket.png';
const imgMonster = new Image(); imgMonster.src = 'assets/monster.png';

// Thực thể game本地
let players = { slot1: null, slot2: null };
let monsters = [];
let ticket = { x: -100, y: -100, spawned: false, pickedUp: false };
let portal = { x: 750, y: 240, width: 60, height: 80, open: false };
let gameLevel = 1;

// Cấu hình phím bấm ảo cho Điện thoại
const buttons = {
    left:   { x: 30,  y: 310, w: 60, h: 60, label: "◀", pressed: false },
    right:  { x: 110, y: 310, w: 60, h: 60, label: "▶", pressed: false },
    jump:   { x: 670, y: 310, w: 60, h: 60, label: "▲", pressed: false },
    action: { x: 750, y: 310, w: 70, h: 60, label: "ATK", pressed: false }
};

// Hàm điều khiển đăng nhập / chuyển cảnh giao diện
function login() {
    myUsername = document.getElementById('username').value.trim();
    if(!myUsername) return alert("Nhập tên vô nè!");
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('lobby-screen').style.display = 'flex';
    document.getElementById('welcome-text').innerText = `Chào ${myUsername} 🐯`;
    
    // Kích hoạt Fullscreen khi tương tác chạm trên điện thoại
    try { document.documentElement.requestFullscreen(); } catch(e){}
}
function createRoom() { socket.emit('createRoom', myUsername); }
function joinRoom() {
    let rId = document.getElementById('room-id-input').value.trim();
    if(!rId) return alert("Nhập ID phòng vào chứ!");
    socket.emit('joinRoom', { roomId: rId, username: myUsername });
}
function startGame() { socket.emit('startGame', currentRoomId); }

// Lắng nghe tín hiệu mạng từ Socket.io
socket.on('roomCreated', (data) => {
    setupRoomUI(data);
});
socket.on('joinSuccess', (data) => {
    setupRoomUI(data);
});
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
    initGameWorld();
    gameLoop();
});
socket.on('peerUpdate', ({ slot, playerData }) => {
    if(players[slot]) {
        players[slot] = { ...players[slot], ...playerData };
    }
});
socket.on('levelUp', (data) => {
    gameLevel = data.level;
    initGameWorld();
});
socket.on('errorMsg', (msg) => alert(msg));
socket.on('playerLeft', () => {
    alert("Người yêu đã rời phòng hoặc rớt mạng rồi 😿!");
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
    if(mySlot === 'slot2') {
        buttons.action.label = "OPEN"; // Đổi nhãn nút bấm cho Slot dưới
    }
}

// Khởi tạo thông số màn chơi mới (Quái mạnh lên 30%)
function initGameWorld() {
    players.slot1 = { x: 150, y: 280, vx: 0, vy: 0, state: 'idle', frame: 0, animTick: 0, dir: 1, isGrounded: true, width: 32, height: 32 };
    players.slot2 = { x: 100, y: 280, vx: 0, vy: 0, state: 'idle', frame: 0, animTick: 0, dir: 1, isGrounded: true, width: 32, height: 32 };
    
    // Quái vật tăng 30% sức mạnh mỗi ải
    let mHp = Math.round(30 * Math.pow(1.3, gameLevel - 1));
    monsters = [
        { x: 400, y: 280, vx: -1, hp: mHp, maxHp: mHp, width: 32, height: 32, dir: -1 },
        { x: 580, y: 280, vx: 1, hp: mHp, maxHp: mHp, width: 32, height: 32, dir: 1 }
    ];
    ticket.spawned = false; ticket.pickedUp = false;
    portal.open = false;
}

// Xử lý sự kiện chạm màn hình cảm ứng (Mobile Touch)
window.addEventListener('touchstart', (e) => {
    if(gameState !== 'playing') return;
    for (let touch of e.touches) {
        let rect = canvas.getBoundingClientRect();
        let clientX = (touch.clientX - rect.left) * (canvas.width / rect.width);
        let clientY = (touch.clientY - rect.top) * (canvas.height / rect.height);
        
        for (let b in buttons) {
            let btn = buttons[b];
            if (clientX >= btn.x && clientX <= btn.x + btn.w && clientY >= btn.y && clientY <= btn.y + btn.h) {
                btn.pressed = true;
                if(b === 'action') performAction();
            }
        }
    }
}, {passive: false});

window.addEventListener('touchend', (e) => {
    if(gameState !== 'playing') return;
    // Reset toàn bộ phím, check lại các touch còn giữ
    for (let b in buttons) buttons[b].pressed = false;
    for (let touch of e.touches) {
        let rect = canvas.getBoundingClientRect();
        let clientX = (touch.clientX - rect.left) * (canvas.width / rect.width);
        let clientY = (touch.clientY - rect.top) * (canvas.height / rect.height);
        for (let b in buttons) {
            let btn = buttons[b];
            if (clientX >= btn.x && clientX <= btn.x + btn.w && clientY >= btn.y && clientY <= btn.y + btn.h) {
                btn.pressed = true;
            }
        }
    }
});

// Xử lý nút Tấn công (Slot 1) hoặc Mở Cổng (Slot 2)
function performAction() {
    let me = players[mySlot];
    if (mySlot === 'slot1') {
        me.state = 'attack';
        // Xử lý vung kiếm chém quái
        monsters.forEach(m => {
            let dist = Math.abs((me.x + 16) - (m.x + 16));
            if(dist < 50) {
                let myDmg = Math.round(10 * Math.pow(1.5, gameLevel - 1)); // Tăng 50% dmg mỗi ải
                m.hp -= myDmg;
            }
        });
        // Lọc xác quái chết, rơi giấy thông hành
        let aliveMonsters = monsters.filter(m => m.hp > 0);
        if(aliveMonsters.length < monsters.length && !ticket.spawned) {
            ticket.spawned = true;
            ticket.x = 450; ticket.y = 290; // Rơi giấy ra đất
        }
        monsters = aliveMonsters;
    } else {
        // Slot 2: Mở cổng nếu nhặt được giấy thông hành và đứng ở cổng
        if (ticket.pickedUp && Math.abs(me.x - portal.x) < 60) {
            portal.open = true;
        }
    }
}

// Hàm cập nhật vật lý, di chuyển
function update() {
    let me = players[mySlot];
    if(!me) return;

    // Di chuyển trái / phải
    if (buttons.left.pressed) {
        me.vx = -3; me.dir = -1; me.state = 'run';
    } else if (buttons.right.pressed) {
        me.vx = 3; me.dir = 1; me.state = 'run';
    } else {
        me.vx = 0; if(me.state !== 'attack') me.state = 'idle';
    }

    // Nhảy lên (Trọng lực)
    if (buttons.jump.pressed && me.isGrounded) {
        me.vy = -10; me.isGrounded = false;
    }

    me.vy += 0.5; // Gia tốc trọng lực
    me.x += me.vx; me.y += me.vy;

    // Giới hạn biên sàn (Độ cao sàn cố định ở mức y=320)
    if(me.y >= 288) { me.y = 288; me.vy = 0; me.isGrounded = true; }
    if(me.x < 0) me.x = 0; if(me.x > canvas.width - me.width) me.x = canvas.width - me.width;

    // Slot 2 tự nhặt giấy khi dẫm vào vị trí giấy
    if (mySlot === 'slot2' && ticket.spawned && !ticket.pickedUp) {
        if(Math.abs(me.x - ticket.x) < 30) ticket.pickedUp = true;
    }

    // Chuyển ải khi hai người cùng chạm cổng đã mở
    if (portal.open && players.slot1.x > 700 && players.slot2.x > 700) {
        if(mySlot === 'slot1') socket.emit('nextLevel', currentRoomId);
    }

    // Hoạt họa Frame ảnh
    me.animTick++;
    if (me.state === 'run') {
        if(me.animTick % 5 === 0) me.frame = (me.frame + 1) % 8; // Cat1.png có 8 frame
    } else if (me.state === 'idle') {
        if(me.animTick % 10 === 0) me.frame = (me.frame + 1) % 3; // Cat_idle.png có 3 frame
    }

    // Quái vật tự động đi tuần tra
    monsters.forEach(m => {
        m.x += m.vx;
        if(m.x < 300 || m.x > 700) { m.vx *= -1; m.dir = m.vx > 0 ? 1 : -1; }
    });

    // Gửi dữ liệu đồng bộ lên server phòng
    socket.emit('playerUpdate', {
        roomId: currentRoomId,
        slot: mySlot,
        playerData: { x: me.x, y: me.y, state: me.state, frame: me.frame, dir: me.dir }
    });
}

// Vẽ toàn bộ thế giới game bằng Canvas
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 1. Vẽ bầu trời & Sàn cỏ 2D xanh lá
    ctx.fillStyle = '#87CEEB'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#228B22'; ctx.fillRect(0, 320, canvas.width, 80);

    // 2. Vẽ Sợi Dây Nối (day.png) ở trung tâm giữa 2 chú mèo
    if (players.slot1 && players.slot2) {
        let midX = (players.slot1.x + players.slot2.x) / 2 + 16;
        let midY = (players.slot1.y + players.slot2.y) / 2 + 16;
        // Vẽ sợi dây bắc cầu nối hai vị trí
        ctx.beginPath(); ctx.strokeStyle = "#ffb6c1"; ctx.lineWidth = 3;
        ctx.moveTo(players.slot1.x + 16, players.slot1.y + 16);
        ctx.lineTo(players.slot2.x + 16, players.slot2.y + 16); ctx.stroke();
        // Vẽ icon trái tim day.png đè lên điểm chính giữa sợi dây
        try { ctx.drawImage(imgLine, 0, 0, 16, 16, midX - 8, midY - 8, 16, 16); } catch(e){}
    }

    // 3. Vẽ Cánh Cổng Vượt Ải
    ctx.fillStyle = portal.open ? '#7fff00' : '#8b4513';
    ctx.fillRect(portal.x, portal.y, portal.width, portal.height);
    ctx.fillStyle = '#fff'; ctx.font = '12px Arial';
    ctx.fillText(portal.open ? "CỔNG MỞ" : "CỔNG KHÓA", portal.x + 2, portal.y - 10);

    // 4. Vẽ Vật phẩm Tờ giấy thông hành (pass_ticket.png)
    if (ticket.spawned && !ticket.pickedUp) {
        try { ctx.drawImage(imgTicket, ticket.x, ticket.y, 25, 25); } catch(e){
            ctx.fillStyle = 'white'; ctx.fillRect(ticket.x, ticket.y, 20, 20);
        }
    }

    // 5. Vẽ Quái vật (monster.png)
    monsters.forEach(m => {
        try { ctx.drawImage(imgMonster, m.x, m.y, m.width, m.height); } catch(e){
            ctx.fillStyle = 'red'; ctx.fillRect(m.x, m.y, m.width, m.height);
        }
        // Thanh máu quái vật
        ctx.fillStyle = 'black'; ctx.fillRect(m.x, m.y - 10, m.width, 4);
        ctx.fillStyle = 'red'; ctx.fillRect(m.x, m.y - 10, m.width * (m.hp / m.maxHp), 4);
    });

    // 6. Vẽ 2 Chú Mèo dựa trên Sprite Sheet bạn cung cấp
    for (let slot in players) {
        let p = players[slot];
        if (!p) continue;
        let sheet = p.state === 'run' ? imgRun : imgIdle;
        let frameW = p.state === 'run' ? (imgRun.width / 8 || 32) : (imgIdle.width / 3 || 32);
        let frameH = sheet.height || 32;

        ctx.save();
        if(p.dir === -1) { // Lật ảnh khi quay đầu chạy trái
            ctx.translate(p.x + 16, p.y + 16); ctx.scale(-1, 1); ctx.translate(-(p.x + 16), -(p.y + 16));
        }
        try {
            ctx.drawImage(sheet, p.frame * frameW, 0, frameW, frameH, p.x, p.y, 32, 32);
        } catch(e) {
            ctx.fillStyle = slot === 'slot1' ? 'blue' : 'pink'; ctx.fillRect(p.x, p.y, 32, 32);
        }
        ctx.restore();

        // Hiện tên tài khoản trên đầu mỗi con mèo
        ctx.fillStyle = 'black'; ctx.font = 'bold 12px Arial';
        ctx.fillText((slot === 'slot1' ? "⚔️ " : "📜 ") + (roomData?.players[slot]?.name || "Mèo"), p.x - 5, p.y - 8);
    }

    // 7. Vẽ giao diện HUD (Ải hiện tại, Trạng thái nhặt giấy)
    ctx.fillStyle = '#ff1493'; ctx.font = 'bold 20px Arial';
    ctx.fillText(`ẢI HIỆN TẠI: ${gameLevel}`, 20, 35);
    if(ticket.pickedUp) {
        ctx.fillStyle = '#006400'; ctx.font = '14px Arial';
        ctx.fillText("✨ Người yêu đã cầm giấy thông hành! Hãy đến cổng!", 20, 60);
    }

    // 8. Vẽ các nút bấm điều khiển cảm ứng giả lập cho di động (Mờ ảo)
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
