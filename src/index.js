import express from 'express';
import logger from 'morgan';
import { Server } from 'socket.io';
import { createServer } from 'http';
import mongoose from 'mongoose';

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

const messageSchema = new mongoose.Schema({
    text: String,
    username: String,
    chat: String
});

const chatSchema = new mongoose.Schema({
    name: String
});

const Message = mongoose.model('Message', messageSchema);
const Chat = mongoose.model('Chat', chatSchema);

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
            const msgs = messages.map(msg => ({ text: msg.text, username: msg.username }));
            socket.emit('chat history', msgs);
        } catch (error) {
            console.error('Error al recuperar mensajes de la base de datos:', error);
        }
    });

    socket.on('disconnect', () => {
        console.log('Se ha desconectado un usuario.');
    });

    socket.on('chat message', async ({ text, username, chat }) => {
        console.log('chat message ' + text);

        const message = new Message({ text, username, chat });
        await message.save();

        console.log("Mensaje guardado en la base de datos");

        socket.to(chat).emit('chat message', { text, username });
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

    socket.on('delete chat', async (chatToDelete) => {
        try {
            await Chat.deleteOne({ name: chatToDelete });
            await Message.deleteMany({ chat: chatToDelete });
            const chats = await Chat.find().exec();
            io.emit('update chats', chats.map(chat => chat.name));
        } catch (error) {
            console.error('Error al eliminar chat de la base de datos:', error);
        }
    });
});

app.use(logger('dev'));
app.use(express.static('public'));

app.get('/', (req, res) => {
    res.sendFile(process.cwd() + '/public/index.html');
});

app.get('/chat.html', (req, res) => {
    res.sendFile(process.cwd() + '/public/chat.html');
});

server.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
