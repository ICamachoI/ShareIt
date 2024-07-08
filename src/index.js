import express from 'express';
import logger from 'morgan';
import { Server } from 'socket.io';
import { createServer } from 'http';
import mongoose from 'mongoose';
import multer from 'multer';
import path from 'path';
import bcrypt from 'bcrypt';

const port = process.env.PORT ?? 4269;

const app = express();

const server = createServer(app);

const io = new Server(server, {
    connectionStateRecovery: {}
});

mongoose.connect('mongodb://localhost:27017/chat-database', {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

const db = mongoose.connection;

db.on('error', console.error.bind(console, 'Error de conexión a MongoDB:'));
db.once('open', () => {
    console.log('Conectado a la base de datos MongoDB');
});

const userSchema = new mongoose.Schema({
    username: {type: String, unique: true},
    password: String
});
const messageSchema = new mongoose.Schema({
    text: String,
    username: String,
    chat: String,
    image: String,
    file: String,
    fileName: String
});
const chatSchema = new mongoose.Schema({
    name: String
});

const User = mongoose.model('User', userSchema);
const Message = mongoose.model('Message', messageSchema);
const Chat = mongoose.model('Chat', chatSchema);

const storage = multer.diskStorage({

    destination: (req, file, cb) => {
        cb(null, 'uploads/');

    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({ storage });

io.on('connection', async (socket) => {
    console.log('Se ha conectado un usuario.');

    try {
        const chats = await Chat.find().exec();
        socket.emit('update chats', chats.map(chat => chat.name));
    } catch (error) {
        console.error('Error al recuperar chats de la base de datos:', error);
    }

    socket.on('join chat', async (chat) => {
        socket.join(chat);
        console.log(`Usuario unido al chat: ${chat}`);

        try {
            const messages = await Message.find({ chat }).exec();
            const msgs = messages.map(msg => ({ text: msg.text, username: msg.username, image: msg.image }));
            socket.emit('chat history', msgs);
        } catch (error) {
            console.error('Error al recuperar mensajes de la base de datos:', error);
        }
    });


    socket.on('disconnect', () => {
        console.log('Se ha desconectado un usuario.');
    });

    socket.on('chat message', async ({ text, username, chat, image, file, fileName }) => {
        console.log('chat message ' + text);

        const message = new Message({ text, username, chat, image, file, fileName });
        await message.save();

        console.log("Mensaje guardado en la base de datos");

        socket.to(chat).emit('chat message', { text, username, image, file, fileName });
    });

    socket.on('new chat', async (newChat) => {
        try {
            const chat = new Chat({ name: newChat });
            await chat.save();
            const chats = await Chat.find().exec();
            io.emit('update chats', chats.map(chat => chat.name));
        } catch (error) {
            console.error('Error al crear nuevo chat en la base de datos:', error);
        }
    });

});

app.use(logger('dev'));

app.use(express.json());

app.use(express.static('public'));

app.use('/uploads', express.static('uploads'));

app.post('/upload', upload.single('image'), (req, res) => {

    if (req.file) {
        res.json({ imageUrl: `/uploads/${req.file.filename}` });
    } else {
        res.status(400).json({ error: 'No file uploaded' });
    }
});

app.post('/register', async (req, res) => {

    const { username, password } = req.body;

    try {

        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.json({ success: false, error: 'El nombre de usuario ya existe.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ username, password: hashedPassword });

        await newUser.save();

        res.json({ success: true });

    } catch (error) {
        res.json({ success: false, error: error.message });
    }

});

app.post('/login', async (req, res) => {

    const { username, password } = req.body;

    try {
        const user = await User.findOne({ username });

        if (!user) {
            return res.json({ success: false, error: 'Nombre de usuario o contraseña incorrectos.'});
        }

        const validPassword = await bcrypt.compare(password, user.password);

        if (!validPassword) {
            return res.json({ success: false, error: 'Nombre de usuario o contraseña incorrectos.'});
        }

        res.json({ success: true });
        
    } catch (error) {
        res.json({ success: false, error: error.message});
    }
    
});

app.get('/', (req, res) => {
    res.sendFile(process.cwd() + '/public/index.html');
});

app.get('/chat.html', (req, res) => {
    res.sendFile(process.cwd() + '/public/chat.html');
});

server.listen(port, () => {
    console.log(`Server running on port ${port}`);
});