const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

async function listModels() {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    try {
        // There is no direct listModels in the client SDK easily accessible this way in all versions
        // but we can try to guess or use a known one.
        console.log("Checking gemini-1.5-flash...");
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent("Hello");
        console.log("Success with gemini-1.5-flash");
    } catch (e) {
        console.log("Failed with gemini-1.5-flash:", e.message);
        try {
            console.log("Checking gemini-pro...");
            const model = genAI.getGenerativeModel({ model: "gemini-pro" });
            const result = await model.generateContent("Hello");
            console.log("Success with gemini-pro");
        } catch (e2) {
            console.log("Failed with gemini-pro:", e2.message);
        }
    }
}
listModels();
