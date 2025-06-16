// bot.js

const fs = require('fs'); // Node.js ka built-in File System module

// --- IMPORTANT ---
// Apna Telegram Bot Token yahan paste karein.
const BOT_TOKEN = "7828707276:AAGa3Y5-sYowEM-DJrDbpTPkwIvDItMTiI0";
const API_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;
const DB_FILE = 'trading_data.json'; // Data store karne ke liye JSON file ka naam

if (BOT_TOKEN === "YOUR_BOT_TOKEN_HERE") {
    console.error("Kripya 'YOUR_BOT_TOKEN_HERE' ko apne asli Telegram Bot Token se badlein.");
    process.exit(1);
}

// =================================================================
// DATABASE (JSON FILE) FUNCTIONS
// =================================================================

// JSON file se data padhne ke liye function
function readDatabase() {
    try {
        // Agar file exist nahi karti hai, toh ek empty object return karein
        if (!fs.existsSync(DB_FILE)) {
            return {};
        }
        const data = fs.readFileSync(DB_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error("Database padhne mein error:", error);
        return {}; // Error hone par empty object return karein
    }
}

// JSON file mein data likhne ke liye function
function writeDatabase(data) {
    try {
        // JSON.stringify(data, null, 2) file ko aasaani se padhne layak format mein likhta hai
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error("Database likhne mein error:", error);
    }
}

// =================================================================
// MESSAGE PROCESSING LOGIC
// =================================================================

// "New Order Opened" message ko handle karne ke liye
function handleNewOrder(text) {
    const newOrderRegex = /Ticket: (\d+)\nSymbol: (.*?)\nType: (.*?)\nLots: (.*?)\nPrice: (.*?)\n-+\nAccount: (\d+)\nBalance: ([\d.,]+)/;
    const match = text.match(newOrderRegex);

    if (!match) {
        console.log("New Order format match nahi hua.");
        return;
    }

    const [_, ticket, symbol, type, lots, price, account, balance] = match;

    const db = readDatabase();

    // Agar account pehli baar aa raha hai, to uske liye entry banayein
    if (!db[account]) {
        db[account] = {
            balance: 0,
            todaysPL: "0.00",
            activeTrades: {},
            lastUpdated: ""
        };
    }

    // Naye trade ko 'activeTrades' mein add karein
    db[account].activeTrades[ticket] = {
        symbol,
        type,
        lots,
        price,
        openTime: new Date().toISOString()
    };

    // Balance aur timestamp update karein
    db[account].balance = parseFloat(balance.replace(/,/g, ''));
    db[account].lastUpdated = new Date().toISOString();

    writeDatabase(db);
    console.log(`✅ Naya Order save hua: Account ${account}, Ticket ${ticket}`);
}

// "Order Closed" message ko handle karne ke liye
function handleClosedOrder(text) {
    const closedOrderRegex = /Ticket: (\d+)\nSymbol: (.*?)\nType: (.*?)\nLots: (.*?)\nProfit: (.*?)\nToday's P\/L: (.*?)\n-+\nAccount: (\d+)\nBalance: ([\d.,]+)/;
    const match = text.match(closedOrderRegex);

    if (!match) {
        console.log("Closed Order format match nahi hua.");
        return;
    }

    const [_, ticket, symbol, type, lots, profit, todaysPL, account, balance] = match;

    const db = readDatabase();

    // Agar account exist nahi karta hai (aisa hona nahi chahiye)
    if (!db[account]) {
        db[account] = { activeTrades: {} }; // fir bhi entry bana de
    }

    // 'activeTrades' se trade ko delete karein
    if (db[account].activeTrades[ticket]) {
        delete db[account].activeTrades[ticket];
    }

    // Balance, Today's P/L, aur timestamp update karein
    db[account].balance = parseFloat(balance.replace(/,/g, ''));
    db[account].todaysPL = todaysPL;
    db[account].lastUpdated = new Date().toISOString();

    writeDatabase(db);
    console.log(`☑️ Order Close hua: Account ${account}, Ticket ${ticket}`);
}

// Bot ko bheje gaye commands ko handle karne ke liye
async function handleCommands(chatId, text) {
    const db = readDatabase();

    if (text === '/status') {
        let summary = "--- Account Status Summary ---\n\n";
        const accounts = Object.keys(db);

        if (accounts.length === 0) {
            summary = "Abhi tak koi data nahi hai.";
        } else {
            for (const acc of accounts) {
                const numActiveTrades = Object.keys(db[acc].activeTrades).length;
                summary += `Account: *${acc}*\n`;
                summary += `  Active Trades: ${numActiveTrades}\n`;
                summary += `  Today's P/L: ${db[acc].todaysPL}\n`;
                summary += `  Balance: ${db[acc].balance}\n\n`;
            }
        }
        await sendMessage(chatId, summary, 'Markdown');
    }

    if (text.startsWith('/status ')) {
        const accNum = text.split(' ')[1];
        if (db[accNum]) {
            const accData = db[accNum];
            let detail = `--- Details for Account: *${accNum}* ---\n\n`;
            detail += `Balance: *${accData.balance}*\n`;
            detail += `Today's P/L: *${accData.todaysPL}*\n\n`;
            detail += "*Active Trades:*\n";
            
            const activeTrades = Object.keys(accData.activeTrades);
            if (activeTrades.length > 0) {
                for (const ticket of activeTrades) {
                    const trade = accData.activeTrades[ticket];
                    detail += `  - \`${trade.symbol}\` (${trade.type} ${trade.lots}) @ ${trade.price} [Ticket: ${ticket}]\n`;
                }
            } else {
                detail += "  _No active trades._\n";
            }
            await sendMessage(chatId, detail, 'Markdown');
        } else {
            await sendMessage(chatId, `Account ${accNum} nahi mila.`);
        }
    }
}


// =================================================================
// TELEGRAM BOT CORE (Ismein changes na karein)
// =================================================================

let lastUpdateId = 0;

async function getUpdates() {
    try {
        const response = await fetch(`${API_URL}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`);
        if (!response.ok) {
            console.error('Updates fetch karne mein error:', response.statusText);
            return;
        }
        const data = await response.json();
        if (data.ok && data.result.length > 0) {
            for (const update of data.result) {
                processMessage(update);
                lastUpdateId = update.update_id;
            }
        }
    } catch (error) {
        console.error('getUpdates function fail hua:', error);
    }
}

function processMessage(update) {
    if (!update.message || !update.message.text) {
        return;
    }

    const message = update.message;
    const chatId = message.chat.id;
    const text = message.text;

    console.log(`Message received from Chat ID ${chatId}: "${text.substring(0, 50)}..."`);

    if (text.startsWith('✅ New Order Opened')) {
        handleNewOrder(text);
    } else if (text.startsWith('☑️ Order Closed')) {
        handleClosedOrder(text);
    } else if (text.startsWith('/')) {
        handleCommands(chatId, text);
    }
}

async function sendMessage(chatId, text, parseMode = '') {
    try {
        const url = `${API_URL}/sendMessage`;
        const params = {
            chat_id: chatId,
            text: text,
        };
        if (parseMode) {
            params.parse_mode = parseMode;
        }
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params)
        });
    } catch (error) {
        console.error('Message bhejne mein error:', error);
    }
}

// Bot ko start karein
console.log('Bot chalu ho gaya hai... Messages ka intezar hai.');
(async () => {
    while (true) {
        await getUpdates();
    }
})();