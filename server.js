const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

let users = {}; 
let currentBets = {}; 

let gameState = {
    timeRemaining: 30,
    status: 'Bắt đầu cược',
    lastResult: { dice: [1, 2, 3], total: 6, type: 'Xỉu' },
    history: [],
    totalTai: 0,
    totalXiu: 0
};

// Hàm trích xuất UID hoặc username từ link Facebook của người dùng
function extractFacebookID(url) {
    if (!url) return "100000000000000";
    // Tìm các chuỗi số UID dạng id=... hoặc profile.php?id=... hoặc chuỗi số cuối đường dẫn
    const matchId = url.match(/(?:id=|\/|profile\.php\?id=)([0-9]{8,})/);
    if (matchId) return matchId[1];
    // Nếu là dạng username (ví dụ: facebook.com/thanhdat), tạm trả về username hoặc chuỗi mẫu để tạo avt sinh động
    const matchUser = url.match(/facebook\.com\/([^/?#]+)/);
    return matchUser ? matchUser[1] : "100000000000000";
}

// --- API HỆ THỐNG TÀI KHOẢN ---
app.post('/api/register', (req, res) => {
    const { username, password, fbLink, fbName } = req.body;
    if (!username || !password || !fbLink || !fbName) {
        return res.json({ status: 'error', msg: 'Vui lòng nhập đầy đủ các trường bắt buộc!' });
    }
    if (users[username]) return res.json({ status: 'error', msg: 'Tài khoản này đã tồn tại trên hệ thống!' });
    
    const targetID = extractFacebookID(fbLink);
    const avatarUrl = `https://graph.facebook.com/${targetID}/picture?height=720&width=720&access_token=6628568379|c1e620fa708a1d5696fb991c1bde5662`;

    users[username] = {
        username,
        password,
        fbName,
        fbLink,
        avatarUrl,
        balance: 500000 // Tặng ngay 500k trải nghiệm
    };
    res.json({ status: 'success', msg: 'Đăng ký tài khoản thành công!' });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (!users[username] || users[username].password !== password) {
        return res.json({ status: 'error', msg: 'Tài khoản hoặc mật khẩu không chính xác!' });
    }
    res.json({ status: 'success', user: users[username] });
});

// --- GAME LOOP ---
setInterval(() => {
    if (gameState.timeRemaining > 0) {
        gameState.timeRemaining--;
    } else {
        if (gameState.status === 'Bắt đầu cược') {
            const d1 = Math.floor(Math.random() * 6) + 1;
            const d2 = Math.floor(Math.random() * 6) + 1;
            const d3 = Math.floor(Math.random() * 6) + 1;
            const total = d1 + d2 + d3;
            const type = total >= 11 ? 'Tài' : 'Xỉu';

            gameState.lastResult = { dice: [d1, d2, d3], total, type };
            gameState.history.push({ type, total });
            if (gameState.history.length > 12) gameState.history.shift();

            gameState.status = 'Đang mở mắt';
            gameState.timeRemaining = 10;

            let winners = [];

            // Xử lý tính toán thưởng/phạt và phát thông báo cá nhân/công khai
            for (const socketId in currentBets) {
                const betInfo = currentBets[socketId];
                if (users[betInfo.username]) {
                    if (betInfo.type === type) {
                        const winAmount = betInfo.amount * 2;
                        users[betInfo.username].balance += winAmount;
                        winners.push(users[betInfo.username].fbName);

                        io.to(socketId).emit('bet-result', { 
                            status: 'win', 
                            amount: winAmount,
                            newBalance: users[betInfo.username].balance
                        });
                    } else {
                        io.to(socketId).emit('bet-result', { 
                            status: 'lose', 
                            newBalance: users[betInfo.username].balance
                        });
                    }
                }
            }

            io.emit('game-result', gameState.lastResult);

            // Gửi thông báo danh sách người chiến thắng vào hộp chat toàn hệ thống
            if (winners.length > 0) {
                io.emit('receive-chat', {
                    system: true,
                    message: `🏆 Các đại gia thắng phiên [${type}]: ${winners.join(', ')}`
                });
            } else {
                io.emit('receive-chat', {
                    system: true,
                    message: `📉 Phiên này kết quả [${type}], không có ai ăn được tiền cược!`
                });
            }
            
            currentBets = {};
            gameState.totalTai = 0;
            gameState.totalXiu = 0;
        } else {
            gameState.status = 'Bắt đầu cược';
            gameState.timeRemaining = 30;
        }
    }
    io.emit('time-update', gameState);
}, 1000);

io.on('connection', (socket) => {
    let currentLoggedUser = null;

    socket.on('join-game', (username) => {
        if (users[username]) {
            currentLoggedUser = username;
            socket.emit('update-balance', users[username].balance);
        }
    });

    socket.on('place-bet', (data) => {
        if (!currentLoggedUser) return socket.emit('notification', 'Bạn chưa đăng nhập!');
        if (gameState.status !== 'Bắt đầu cược') return socket.emit('notification', 'Hết thời gian đặt cược!');

        const { type, amount } = data;
        const user = users[currentLoggedUser];

        if (user.balance < amount || amount <= 0) {
            return socket.emit('notification', 'Số dư tài khoản của bạn không đủ!');
        }
        if (currentBets[socket.id]) {
            return socket.emit('notification', `Bạn đã đặt cửa [${currentBets[socket.id].type}], không được cược 2 bên!`);
        }

        user.balance -= amount;
        currentBets[socket.id] = { username: currentLoggedUser, type, amount };

        if (type === 'Tài') gameState.totalTai += amount;
        if (type === 'Xỉu') gameState.totalXiu += amount;

        socket.emit('update-balance', user.balance);
        io.emit('time-update', gameState);
        
        // Phát thông báo ai cược bao nhiêu lên khung chat của cả phòng
        io.emit('receive-chat', {
            system: true,
            message: `💸 Người chơi [${user.fbName}] vừa tất tay cược ${amount.toLocaleString()}đ vào cửa [${type}]`
        });
    });

    socket.on('send-chat', (msg) => {
        if (!currentLoggedUser) return;
        const user = users[currentLoggedUser];
        io.emit('receive-chat', { 
            system: false,
            name: user.username, 
            fbName: user.fbName,
            avatarUrl: user.avatarUrl,
            fbLink: user.fbLink,
            balance: user.balance,
            message: msg 
        });
    });

    socket.on('get-profile', (targetUsername, callback) => {
        if (users[targetUsername]) {
            callback({ status: 'success', data: users[targetUsername] });
        } else {
            callback({ status: 'error' });
        }
    });

    socket.on('disconnect', () => {});
});

http.listen(PORT, () => {
    console.log(`Server Tài Xỉu Cyberpunk Premium trực tuyến tại cổng: ${PORT}`);
});
