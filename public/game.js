const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let myUsername = "";
let currentRoomId = null;
let mySlot = null;
let roomData = null;
let gameState = 'lobby';

// --- TẢI TÀI NGUYÊN HÌNH ẢNH CẬP NHẬT ---
const imgIdle = new Image(); imgIdle.src = 'assets/cat_idle.png';
const imgRun = new Image(); imgRun.src = 'assets/cat1.png';
const imgLine = new Image(); imgLine.src = 'assets/day.png';

// Ảnh mới theo yêu cầu
const imgTicket = new Image(); imgTicket.src = 'assets/bando.png';
const imgMonster = new Image(); imgMonster.src = 'assets/chuot.png';
const imgMSpit = new Image(); imgMSpit.src = 'assets/chuotskill.png';
const imgHeartFx = new Image(); imgHeartFx.src = 'assets/tim.png';
const imgSword = new Image(); imgSword.src = 'assets/kiem.png';

// --- THÔNG SỐ KHÔNG GIAN GAME ---
const V_WIDTH = 850;   // Chiều rộng vùng hiển thị màn hình
const V_HEIGHT = 400;  // Chiều cao vùng hiển thị màn hình
const MAP_WIDTH = 1700; // Bản đồ dài gấp đôi (x2)
const FLOOR_Y = 320;   // Vị trí mặt sàn

// Kích thước mèo tăng lên gấp 3 (Gốc 32x32 -> 96x96)
const CAT_W = 96;
const CAT_H = 96;
const MAX_ROPE_DIST = 350; // Khoảng cách dây tối đa trước khi kéo giật/đứt hẳn

let players = { slot1: null, slot2: null };
let monsters = [];
let playerProjectiles = []; // Đạn kiếm của Sát thủ
let monsterProjectiles = []; // Đạn nước bọt của Chuột
let ticket = { x: -100, y: -100, spawned: false, pickedUp: false };
let portal = { x: 1550, y: FLOOR_Y - 120, width: 80, height: 120, open: false };
let gameLevel = 1;

// Biến hiệu ứng và camera toàn cục
let cameraX = 0;
let healEffectTimer = 0; // Đếm thời gian hiển thị tim bay lên khi hồi máu
let ropeWarningTimer = 0;
let gameOverReason = "";

// Cấu hình phím bấm ảo HUD (Cố định góc màn hình hiển thị)
const buttons = {
    left:   { x: 30,  y: 310, w: 60, h: 60, label: "◀", pressed: false },
    right:  { x: 110, y: 310, w: 60, h: 60, label: "▶", pressed: false },
    jump:   { x: 650, y: 310, w: 60, h: 60, label: "▲", pressed: false },
    action: { x: 730, y: 310, w: 90, h: 60, label: "ATK", pressed: false } 
};

function resizeCanvas() {
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
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

// Đồng bộ hành động đặc biệt từ mạng xã hội socket
socket.on('peerAction', ({ actionType }) => {
    if (actionType === 'heal') {
        healEffectTimer = 45; // Kích hoạt hiển thị tim
        if (players.slot1) {
            players.slot1.hp = Math.min(players.slot1.maxHp, players.slot1.hp + Math.round(players.slot1.maxHp * 0.2));
        }
    } else if (actionType === 'shoot') {
        if (players.slot1) {
            playerProjectiles.push({
                x: players.slot1.x + (players.slot1.dir === 1 ? CAT_W : -20),
                y: players.slot1.y + CAT_H / 2 - 10,
                vx: players.slot1.dir * 7,
                w: 40, h: 20
            });
        }
    }
});

socket.on('peerUpdate', ({ slot, playerData }) => {
    if(players[slot]) {
        // Chỉ lấy các thuộc tính di chuyển và frame từ đồng đội để tránh ghi đè HP cục bộ sai lệch
        players[slot].x = playerData.x;
        players[slot].y = playerData.y;
        players[slot].state = playerData.state;
        players[slot].frame = playerData.frame;
        players[slot].dir = playerData.dir;
    }
});

socket.on('levelUp', (data) => {
    gameLevel = data.level;
    initGameWorld();
});
socket.on('errorMsg', (msg) => alert(msg));
socket.on('playerLeft', () => {
    alert("Đồng đội đã rời trận mất tiêu 😿!");
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
    
    // Gán nhãn tên nút chức năng theo Slot
    if(mySlot === 'slot1') buttons.action.label = "KIẾM";
    if(mySlot === 'slot2') buttons.action.label = "HỒI MÁU";
}

function initGameWorld() {
    // ⚔️ Tăng 50% chỉ số mỗi ải cho Người chơi (Máu)
    let pMaxHp = Math.round(100 * Math.pow(1.5, gameLevel - 1));

    players.slot1 = { x: 200, y: FLOOR_Y - CAT_H, vx: 0, vy: 0, state: 'idle', frame: 0, animTick: 0, dir: 1, isGrounded: true, width: CAT_W, height: CAT_H, hp: pMaxHp, maxHp: pMaxHp };
    players.slot2 = { x: 100, y: FLOOR_Y - CAT_H, vx: 0, vy: 0, state: 'idle', frame: 0, animTick: 0, dir: 1, isGrounded: true, width: CAT_W, height: CAT_H, hp: pMaxHp, maxHp: pMaxHp };
    
    monsters = [];
    playerProjectiles = [];
    monsterProjectiles = [];
    ticket.spawned = false; ticket.pickedUp = false;
    portal.open = false;
    gameOverReason = "";

    // Sinh 3 con chuột ban đầu rải rác trên map dài 1700
    spawnMonster(450);
    spawnMonster(800);
    spawnMonster(1200);
}

function spawnMonster(customX) {
    // 🐀 Quái vật tăng 40% sức mạnh mỗi ải (Máu và Sát thương)
    let mHp = Math.round(30 * Math.pow(1.4, gameLevel - 1));
    let spawnX = customX !== undefined ? customX : (Math.random() * 1000 + 400);
    monsters.push({
        x: spawnX,
        y: FLOOR_Y - 48,
        vx: (Math.random() > 0.5 ? 1 : -1) * 1.5,
        hp: mHp, maxHp: mHp,
        width: 48, height: 48,
        dir: 1,
        shootCooldown: Math.floor(Math.random() * 100) + 50
    });
}

function getTouchPos(touch) {
    let rect = canvas.getBoundingClientRect();
    let scaleX = V_WIDTH / rect.width;
    let scaleY = V_HEIGHT / rect.height;
    return { x: (touch.clientX - rect.left) * scaleX, y: (touch.clientY - rect.top) * scaleY };
}

window.addEventListener('touchstart', (e) => {
    if(gameState !== 'playing' || gameOverReason) return;
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
    if(gameOverReason) return;
    let me = players[mySlot];
    if (!me) return;

    if (mySlot === 'slot1') {
        // MÈO SÁT THỦ: Bắn kiếm bay ngang kiem.png
        me.state = 'attack';
        playerProjectiles.push({
            x: me.x + (me.dir === 1 ? CAT_W : -20),
            y: me.y + CAT_H / 2 - 10,
            vx: me.dir * 7,
            w: 40, h: 20
        });
        socket.emit('playerAction', { roomId: currentRoomId, actionType: 'shoot' });
    } else {
        // MÈO HỖ TRỢ: Nút hồi máu cho Sát thủ
        socket.emit('playerAction', { roomId: currentRoomId, actionType: 'heal' });
        healEffectTimer = 45; 
        if (players.slot1) {
            players.slot1.hp = Math.min(players.slot1.maxHp, players.slot1.hp + Math.round(players.slot1.maxHp * 0.2));
        }
        
        // Cơ chế nhặt bản đồ chủ động: Nếu đứng gần và chưa nhặt, ấn nút Action để nhặt
        if (ticket.spawned && !ticket.pickedUp) {
            if (Math.abs(me.x + CAT_W/2 - ticket.x) < 80) {
                ticket.pickedUp = true;
            }
        }
        // Kích hoạt cổng mở nếu Hỗ trợ cầm bản đồ đứng sát cổng
        if (ticket.pickedUp && Math.abs((me.x + CAT_W/2) - (portal.x + 40)) < 80) {
            portal.open = true;
        }
    }
}

function update() {
    if(gameOverReason) return;

    let me = players[mySlot];
    if(!me) return;

    // --- DI CHUYỂN NHÂN VẬT ---
    if (buttons.left.pressed) {
        me.vx = -4; me.dir = -1; me.state = 'run';
    } else if (buttons.right.pressed) {
        me.vx = 4; me.dir = 1; me.state = 'run';
    } else {
        me.vx = 0; if(me.state !== 'attack') me.state = 'idle';
    }

    if (buttons.jump.pressed && me.isGrounded) {
        me.vy = -12; me.isGrounded = false;
    }

    me.vy += 0.6; // Trọng lực
    me.x += me.vx; me.y += me.vy;

    if(me.y >= FLOOR_Y - CAT_H) {
        me.y = FLOOR_Y - CAT_H; me.vy = 0; me.isGrounded = true;
    }
    if(me.x < 0) me.x = 0; if(me.x > MAP_WIDTH - CAT_W) me.x = MAP_WIDTH - CAT_W;

    // --- HOẠT HỌA FRAME MÈO GRID SHEET ---
    me.animTick++;
    if (me.state === 'run') {
        if(me.animTick % 5 === 0) me.frame = (me.frame + 1) % 8;
    } else if (me.state === 'idle') {
        if(me.animTick % 10 === 0) me.frame = (me.frame + 1) % 3;
    }

    // Gửi dữ liệu đồng bộ sang máy đối phương
    socket.emit('playerUpdate', {
        roomId: currentRoomId,
        slot: mySlot,
        playerData: { x: me.x, y: me.y, state: me.state, frame: me.frame, dir: me.dir }
    });

    // --- CAMERA DÍ THEO NHÂN VẬT CỦA BẠN ---
    cameraX = me.x + CAT_W / 2 - V_WIDTH / 2;
    if(cameraX < 0) cameraX = 0;
    if(cameraX > MAP_WIDTH - V_WIDTH) cameraX = MAP_WIDTH - V_WIDTH;

    // --- CƠ CHẾ SỢI DÂY CO GIÃN LIÊN KẾT ---
    if (players.slot1 && players.slot2) {
        let p1Center = players.slot1.x + CAT_W / 2;
        let p2Center = players.slot2.x + CAT_W / 2;
        let dist = Math.abs(p1Center - p2Center);

        if (dist > MAX_ROPE_DIST) {
            ropeWarningTimer++;
            
            // Lực đàn hồi kéo giật hai con mèo lại gần nhau (Hiệu ứng co giãn)
            let pullForce = (dist - MAX_ROPE_DIST) * 0.05;
            if (p1Center > p2Center) {
                players.slot1.x -= pullForce;
                players.slot2.x += pullForce;
            } else {
                players.slot1.x += pullForce;
                players.slot2.x -= pullForce;
            }

            // Nếu kéo căng quá lâu (khoảng 3 giây cảnh báo liên tục) -> Đứt dây, xử THUA
            if (ropeWarningTimer > 180) {
                gameOverReason = "SỢI DÂY ĐỊNH MỆNH ĐÃ BỊ ĐỨT DO QUÁ XA!";
            }
        } else {
            if(ropeWarningTimer > 0) ropeWarningTimer--;
        }
    }

    // --- CƠ CHẾ QUÁI VẬT CHUỘT (HỒI SINH LIÊN TỤC + BẮN SKILL) ---
    monsters.forEach((m, idx) => {
        m.x += m.vx;
        if(m.x < 100 || m.x > MAP_WIDTH - 100) { m.vx *= -1; }
        m.dir = m.vx > 0 ? 1 : -1;

        // Chuột bắn skill khè nước bọt chuotskill.png tự động
        m.shootCooldown--;
        if (m.shootCooldown <= 0) {
            let mDmg = Math.round(8 * Math.pow(1.4, gameLevel - 1));
            monsterProjectiles.push({
                x: m.x + (m.dir === 1 ? m.width : -16),
                y: m.y + 15,
                vx: m.dir * 4,
                w: 20, h: 20,
                dmg: mDmg
            });
            m.shootCooldown = Math.floor(Math.random() * 120) + 80; // Reset thời gian chờ bắng tiếp
        }
    });

    // --- XỬ LÝ ĐẠN KIẾM CỦA SÁT THỦ ---
    playerProjectiles.forEach((p, pIdx) => {
        p.x += p.vx;
        // Kiểm tra va chạm với Chuột
        monsters.forEach((m, mIdx) => {
            if (p.x + p.w >= m.x && p.x <= m.x + m.width && p.y + p.h >= m.y && p.y <= m.y + m.height) {
                let sDmg = Math.round(15 * Math.pow(1.5, gameLevel - 1));
                m.hp -= sDmg;
                playerProjectiles.splice(pIdx, 1);

                // Khi chuột chết: Tự động hồi sinh con khác ngay lập tức ở vị trí ngẫu nhiên
                if (m.hp <= 0) {
                    monsters.splice(mIdx, 1);
                    spawnMonster(); // HỒI SINH LIÊN TỤC

                    // Tỷ lệ rớt bản đồ bando.png (33%) khi giết quái vật
                    if (!ticket.spawned && Math.random() < 0.34) {
                        ticket.spawned = true;
                        ticket.x = m.x; ticket.y = FLOOR_Y - 40;
                    }
                }
            }
        });
    });
    // Xóa đạn kiếm bay ra khỏi bản đồ
    playerProjectiles = playerProjectiles.filter(p => p.x > 0 && p.x < MAP_WIDTH);

    // --- XỬ LÝ ĐẠN NƯỚC BỌT CỦA CHUỘT ---
    monsterProjectiles.forEach((mp, mpIdx) => {
        mp.x += mp.vx;
        // Trúng mèo nào thì mèo đó trừ máu
        for (let slot in players) {
            let cat = players[slot];
            if (cat && mp.x + mp.w >= cat.x && mp.x <= cat.x + CAT_W && mp.y + mp.h >= cat.y && mp.y <= cat.y + CAT_H) {
                cat.hp -= mp.dmg;
                monsterProjectiles.splice(mpIdx, 1);
                
                if (cat.hp <= 0) {
                    gameOverReason = `${slot === 'slot1' ? 'SÁT THỦ' : 'HỖ TRỢ'} ĐÃ BỊ CHUỘT ĐÁNH BẠI!`;
                }
            }
        }
    });
    monsterProjectiles = monsterProjectiles.filter(mp => mp.x > 0 && mp.x < MAP_WIDTH);

    // --- QUA ẢI MỚI KHI CẢ HAI ĐẾN CỔNG ---
    if (portal.open && players.slot1.x > portal.x - 20 && players.slot2.x > portal.x - 20) {
        if(mySlot === 'slot1') socket.emit('nextLevel', currentRoomId);
    }

    if(healEffectTimer > 0) healEffectTimer--;
}

function draw() {
    ctx.clearRect(0, 0, V_WIDTH, V_HEIGHT);

    ctx.save();
    // Áp dụng Ma trận Dịch chuyển Camera để cuốn thế giới game chạy theo góc nhìn nhân vật
    ctx.translate(-cameraX, 0);

    // 1. Vẽ nền bầu trời kéo dài x2 và Mặt sàn cố định kéo dài x2
    ctx.fillStyle = '#708090'; ctx.fillRect(0, 0, MAP_WIDTH, V_HEIGHT);
    ctx.fillStyle = '#3a3a3a'; ctx.fillRect(0, FLOOR_Y, MAP_WIDTH, V_HEIGHT - FLOOR_Y);

    // 2. Vẽ Sợi Dây Trái Tim Định Mệnh ở giữa 2 mèo
    if (players.slot1 && players.slot2) {
        let p1C = { x: players.slot1.x + CAT_W / 2, y: players.slot1.y + CAT_H / 2 };
        let p2C = { x: players.slot2.x + CAT_W / 2, y: players.slot2.y + CAT_H / 2 };
        let midX = (p1C.x + p2C.x) / 2;
        let midY = (p1C.y + p2C.y) / 2;
        
        ctx.beginPath();
        ctx.strokeStyle = ropeWarningTimer > 0 ? "#ff0000" : "#ff69b4"; 
        ctx.lineWidth = ropeWarningTimer > 0 ? 5 : 3;
        ctx.moveTo(p1C.x, p1C.y); ctx.lineTo(p2C.x, p2C.y); ctx.stroke();
        
        // Trái tim chính giữa sợi dây chính là SINH MẠNG quyết định hiển thị
        try {
            ctx.drawImage(imgHeartFx, midX - 20, midY - 20, 40, 40);
        } catch(e) {
            ctx.fillStyle = 'red'; ctx.fillRect(midX - 15, midY - 15, 30, 30);
        }
    }

    // 3. Vẽ Cổng Vượt Ải Cuối Bản Đồ (x2)
    ctx.fillStyle = portal.open ? '#00ffcc' : '#4a2e1b';
    ctx.fillRect(portal.x, portal.y, portal.width, portal.height);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 14px Arial';
    ctx.fillText(portal.open ? "CỔNG MỞ" : "CỔNG KHÓA", portal.x + 2, portal.y - 15);

    // 4. Vẽ Bản đồ bando.png khi quái rớt ra
    if (ticket.spawned && !ticket.pickedUp) {
        try { ctx.drawImage(imgTicket, ticket.x, ticket.y, 45, 45); } catch(e){
            ctx.fillStyle = 'orange'; ctx.fillRect(ticket.x, ticket.y, 35, 35);
        }
        ctx.fillStyle = '#ffff00'; ctx.font = '11px Arial';
        ctx.fillText("HỖ TRỢ LẠI NHẶT!", ticket.x - 15, ticket.y - 8);
    }

    // 5. Vẽ Toàn bộ lũ Chuột quái vật
    monsters.forEach(m => {
        try { ctx.drawImage(imgMonster, m.x, m.y, m.width, m.height); } catch(e){
            ctx.fillStyle = 'purple'; ctx.fillRect(m.x, m.y, m.width, m.height);
        }
        // Thanh HP quái
        ctx.fillStyle = 'black'; ctx.fillRect(m.x, m.y - 12, m.width, 5);
        ctx.fillStyle = '#ff3300'; ctx.fillRect(m.x, m.y - 12, m.width * (m.hp / m.maxHp), 5);
    });

    // 6. Vẽ Đạn nước bọt chuotskill.png của Chuột
    monsterProjectiles.forEach(mp => {
        try { ctx.drawImage(imgMSpit, mp.x, mp.y, mp.w, mp.h); } catch(e) {
            ctx.fillStyle = 'cyan'; ctx.beginPath(); ctx.arc(mp.x+10, mp.y+10, 8, 0, Math.PI*2); ctx.fill();
        }
    });

    // 7. Vẽ Đạn Kiếm kiem.png của Sát thủ (Xoay nằm ngang đâm về phía trước)
    playerProjectiles.forEach(p => {
        ctx.save();
        ctx.translate(p.x + p.w / 2, p.y + p.h / 2);
        // Vì ảnh gốc kiếm đứng dọc, xoay 90 độ (Math.PI / 2) để mũi kiếm nằm ngang lao đi thẳng thớm
        ctx.rotate(p.vx > 0 ? Math.PI / 2 : -Math.PI / 2);
        try {
            ctx.drawImage(imgSword, -p.h / 2, -p.w / 2, p.h, p.w);
        } catch(e) {
            ctx.fillStyle = 'yellow'; ctx.fillRect(-p.w/2, -p.h/2, p.w, p.h);
        }
        ctx.restore();
    });

    // 8. Vẽ Hiệu Ứng Tim Hồi Máu Bay Phấp Phới Trên Đầu Sát Thủ
    if (healEffectTimer > 0 && players.slot1) {
        try {
            ctx.drawImage(imgHeartFx, players.slot1.x + CAT_W/2 - 20, players.slot1.y - 45 - (45 - healEffectTimer), 40, 40);
        } catch(e){}
    }

    // 9. Vẽ 2 Chú Mèo (Kích thước lớn x3)
    for (let slot in players) {
        let p = players[slot];
        if (!p) continue;

        let sheet = p.state === 'run' ? imgRun : imgIdle;
        let cols = p.state === 'run' ? 3 : 2;
        let frameW = sheet.width / cols;
        let frameH = sheet.height / 3;
        let col = p.frame % cols;
        let row = Math.floor(p.frame / cols);

        ctx.save();
        if(p.dir === -1) {
            ctx.translate(p.x + CAT_W/2, p.y + CAT_H/2); ctx.scale(-1, 1); ctx.translate(-(p.x + CAT_W/2), -(p.y + CAT_H/2));
        }
        try {
            ctx.drawImage(sheet, col * frameW, row * frameH, frameW, frameH, p.x, p.y, CAT_W, CAT_H);
        } catch(e) {
            ctx.fillStyle = slot === 'slot1' ? '#00bfff' : '#ff69b4'; ctx.fillRect(p.x, p.y, CAT_W, CAT_H);
        }
        ctx.restore();

        // Vẽ tên + Thanh máu người chơi phía trên đầu
        ctx.fillStyle = 'white'; ctx.font = 'bold 13px Arial';
        ctx.fillText((slot === 'slot1' ? "⚔️ SÁT THỦ: " : "📜 HỖ TRỢ: ") + (roomData?.players[slot]?.name || "Mèo"), p.x, p.y - 24);
        
        ctx.fillStyle = 'red'; ctx.fillRect(p.x, p.y - 16, CAT_W, 6);
        ctx.fillStyle = '#00ff00'; ctx.fillRect(p.x, p.y - 16, CAT_W * (p.hp / p.maxHp), 6);
    }

    ctx.restore(); // Thoát khỏi ma trận camera dịch chuyển sang vẽ HUD cố định

    // --- 10. GIAO DIỆN HUD TRÊN MÀN HÌNH CỐ ĐỊNH ---
    ctx.fillStyle = '#ff1493'; ctx.font = 'bold 20px Arial';
    ctx.fillText(`ẢI: ${gameLevel}`, 20, 35);

    if (ticket.pickedUp) {
        ctx.fillStyle = '#7fff00'; ctx.font = 'bold 15px Arial';
        ctx.fillText("✨ ĐÃ NHẶT BẢN ĐỒ! HỖ TRỢ HÃY DI CHUYỂN TỚI CỔNG ĐỂ MỞ KHÓA!", 140, 35);
    }

    // Cảnh báo căng thẳng nếu kéo căng sợi dây định mệnh sắp đứt
    if (ropeWarningTimer > 0) {
        ctx.fillStyle = 'red'; ctx.font = 'bold 18px Arial';
        ctx.fillText(`⚠️ CẢNH BÁO: QUÁ XA NHAU! SỢI DÂY SẼ ĐỨT SAU: ${Math.max(0, Math.ceil((180-ropeWarningTimer)/60))}s`, 20, 70);
    }

    // Vẽ màn hình Thất bại/ Game Over
    if (gameOverReason) {
        ctx.fillStyle = 'rgba(0,0,0,0.85)'; ctx.fillRect(0, 0, V_WIDTH, V_HEIGHT);
        ctx.fillStyle = 'red'; ctx.font = 'bold 30px Arial'; ctx.fillText("GAME OVER", V_WIDTH/2 - 90, V_HEIGHT/2 - 20);
        ctx.fillStyle = 'white'; ctx.font = '16px Arial'; ctx.fillText(gameOverReason, V_WIDTH/2 - 180, V_HEIGHT/2 + 20);
        ctx.fillStyle = 'yellow'; ctx.fillText("reset lại trang để cùng người thương làm lại từ đầu nha!", V_WIDTH/2 - 190, V_HEIGHT/2 + 50);
        return;
    }

    // Vẽ các nút ảo HUD
    for (let b in buttons) {
        let btn = buttons[b];
        ctx.fillStyle = btn.pressed ? 'rgba(255,105,180,0.8)' : 'rgba(255,255,255,0.35)';
        ctx.strokeStyle = '#ff69b4'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.roundRect(btn.x, btn.y, btn.w, btn.h, 12); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.font = 'bold 14px Arial';
        ctx.fillText(btn.label, btn.x + 8, btn.y + (btn.h/2) + 5);
    }
}

function gameLoop() {
    if (gameState !== 'playing') return;
    update();
    draw();
    requestAnimationFrame(gameLoop);
}
