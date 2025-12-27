
const http = require('http');

console.log('Testing GET /v1/sessions...');
const req = http.get('http://localhost:8080/v1/sessions', (res) => {
    console.log(`Status: ${res.statusCode}`);
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
        console.log('Response:');
        console.log(data);
    });
});

req.on('error', (e) => {
    console.error(`Error: ${e.message}`);
});

req.end();
