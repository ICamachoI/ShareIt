import express from 'express';
import logger from 'morgan';
import { Server } from 'socket.io';
import { createServer } from 'http';
import mongoose from 'mongoose';
import multer from 'multer';
import path from 'path';
import bcrypt from 'bcrypt';

//Define el puerto que escuchara el servidor - Defines the port that the server will listen to
const port = process.env.PORT ?? 4269;

//Crea una instancia de express - Creates an instance of express
const app = express();

//Crea un servidor - Creates a server
const server = createServer(app);

//Crea una instancia de socket.io y la conecta al server - Creates an instance of socket.io and connects it to the server
const io = new Server(server, {
    connectionStateRecovery: {}
});

//Conecta con la base de datos chat-database - Connects with the database chat-database
mongoose.connect('mongodb://localhost:27017/chat-database', {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

//Establece la conexion - Sets the connection
const db = mongoose.connection;

//Le confirma al servidor si la conexion se logro - Confirms to the server if the connection was successful
db.on('error', console.error.bind(console, 'Error de conexión a MongoDB:'));
db.once('open', () => {
    console.log('Conectado a la base de datos MongoDB');
});

//Define los esquemas de mongoose para user, message y chat - Defines mongoose schemas for user, message, and chat
const userSchema = new mongoose.Schema({
    username: {type: String, unique: true},
    password: String
});
const messageSchema = new mongoose.Schema({
    text: String,
    username: String,
    chat: String,
    image: String 
});
const chatSchema = new mongoose.Schema({
    name: String
});

const User = mongoose.model('User', userSchema);
const Message = mongoose.model('Message', messageSchema);
const Chat = mongoose.model('Chat', chatSchema);

//Configura multer para guardar los archivos subidos y se les asigna un nombre
const storage = multer.diskStorage({

    destination: (req, file, cb) => {
        cb(null, 'uploads/');

    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({ storage });

//Imprime en la consola que se ha conectado un usuario - Prints in the console that a user has connected
io.on('connection', async (socket) => {
    console.log('Se ha conectado un usuario.');

    //Intenta recuperar los chats de la base de datos - Tries to recover the chats from the database
    try {
        const chats = await Chat.find().exec();
        socket.emit('update chats', chats.map(chat => chat.name));
    } catch (error) {
        console.error('Error al recuperar chats de la base de datos:', error);
    }

    //Activa el evento join chat - Activates the event join chat
    socket.on('join chat', async (chat) => {
        socket.join(chat);
        console.log(`Usuario unido al chat: ${chat}`);

        //Intenta recuperar el historial de los chats de la base de datos - Tries to recover the chat history from the database
        try {
            const messages = await Message.find({ chat }).exec();
            const msgs = messages.map(msg => ({ text: msg.text, username: msg.username, image: msg.image }));
            socket.emit('chat history', msgs);
        } catch (error) {
            console.error('Error al recuperar mensajes de la base de datos:', error);
        }
    });

    //Imprime en la consola que se ha desconectado un usuario - Prints in the console that a user has disconnected
    socket.on('disconnect', () => {
        console.log('Se ha desconectado un usuario.');
    });

    //Maneja el evento chat message y manda el mensaje a todos los usuarios del chat y al servidor - Manages the chat message event and send the message to all chat users and the server
    socket.on('chat message', async ({ text, username, chat, image }) => {
        console.log('chat message ' + text);

        const message = new Message({ text, username, chat, image });
        await message.save();

        console.log("Mensaje guardado en la base de datos");

        socket.to(chat).emit('chat message', { text, username, image });
    });

    //Maneja el evento new chat que intenta crear y guardar un nuevo chat en la base de datos - Handles the new chat event that attempts to create and save a new chat to the database
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

//Muestra las solicitudes que llegan al servidor - Shows the requests that arrive at the server
app.use(logger('dev'));

//Analiza las solicitudes y las convierte en un objeto js accesible - Parses requests and converts them into an accessible js object
app.use(express.json());

//Hace que los archivos de la carpeta public esten disponibles publicamente - Makes files in the public folder publicly available
app.use(express.static('public'));

//Hace que los archivos de la carpeta uploads del servidor esten disponibles publicamente - Makes files in the server's uploads folder publicly available
app.use('/uploads', express.static('uploads'));

//Define una ruta POST en la carpeta upload y procesa la subida del archivo image - Defines a POST path in the upload folder and processes the upload of the image file
app.post('/upload', upload.single('image'), (req, res) => {

    if (req.file) {
        res.json({ imageUrl: `/uploads/${req.file.filename}` });
    } else {
        res.status(400).json({ error: 'No file uploaded' });
    }
});

//Define una ruta POST en register y procesa la subida del archivo image - Defines a POST path in register and processes the upload of the image file
app.post('/register', async (req, res) => {

    //Extrae las propiedades username y password enviadas por el cliente -  Extracts the username and password properties sent by the client
    const { username, password } = req.body;

    try {

        //Busca si el nombre de usuario ya existed y se lo notifica al usuario en caso de que sea asi - Checks to see if the username already existed and notifies the user if so 
        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.json({ success: false, error: 'El nombre de usuario ya existe.' });
        }

        //Si no existe ese nombre de usuario cifra la contrasena proporcionada con bcrypt - If that username does not exist, encrypt the provided password with bcrypt
        const hashedPassword = await bcrypt.hash(password, 10);
        //Crea la cuenta con el nombre de usuario y contrasena proporcionados - Create the account with the provided username and password
        const newUser = new User({ username, password: hashedPassword });

        //Guarda la cuenta en la base de datos - Save the account to the database
        await newUser.save();

        //Le notifica al cliente que se ha creado la cuenta - Notifies the customer that the account has been created
        res.json({ success: true });

    } catch (error) {
        res.json({ success: false, error: error.message });
    }

});

//Define una ruta POST en login y procesa la subida del archivo image - Defines a POST path in login and processes the upload of the image file
app.post('/login', async (req, res) => {

    //Extrae las propiedades username y password enviadas por el cliente -  Extracts the username and password properties sent by the client
    const { username, password } = req.body;

    try {
        //Busca si el nombre de usuario existe - Check if the username exists
        const user = await User.findOne({ username });

        //Si el usuario no existe se lo notifica al usuario - If the user does not exist, the user is notified
        if (!user) {
            return res.json({ success: false, error: 'Nombre de usuario o contraseña incorrectos.'});
        }

        //Compara la contrasena con la de la base de datos - Compare the password with that of the database
        const validPassword = await bcrypt.compare(password, user.password);

        //Si la contrasena no coincide se lo notifica al usuario - If the password does not match, the user is notified.
        if (!validPassword) {
            return res.json({ success: false, error: 'Nombre de usuario o contraseña incorrectos.'});
        }

        //Si el usuario y la contrasena son correctos envia una respuesta de success - If the username and password are correct, it sends a success response
        res.json({ success: true });
        
    } catch (error) {
        res.json({ success: false, error: error.message});
    }
    
});

//Envia al cliente a la ruta indicada cuando este la solicita - Sends the client to the indicated route when he requests it
app.get('/', (req, res) => {
    res.sendFile(process.cwd() + '/public/index.html');
});

//Envia al cliente a la ruta indicada cuando este la solicita - Sends the client to the indicated route when he requests it
app.get('/chat.html', (req, res) => {
    res.sendFile(process.cwd() + '/public/chat.html');
});

//Inicia el servidor para que escuche las solicitudes entrantes en el puerto especificado y lo avisa en la consola - Starts the server to listen for incoming requests on the specified port and reports this to the console
server.listen(port, () => {
    console.log(`Server running on port ${port}`);
});