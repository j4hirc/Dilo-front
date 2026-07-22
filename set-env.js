const fs = require('fs');

const dir = './src/environments';
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

// Tomamos las variables desde Netlify, o usamos valores por defecto
const envConfigFile = `export const environment = {
  production: true,
  apiUrl: '${process.env.API_URL || "https://dilo-backend-mxlu.onrender.com/api/v1"}',
  groqApiKey: '${process.env.GROQ_API_KEY || ""}' 
};
`;

fs.writeFileSync('./src/environments/environment.ts', envConfigFile);
console.log(`Archivo environment.ts generado correctamente con la API URL.`);