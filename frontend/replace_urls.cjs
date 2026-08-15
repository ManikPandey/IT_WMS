const fs = require('fs');
const path = require('path');

const directoryPath = path.join(__dirname, 'src');

function replaceInFile(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');
    let original = content;

    // Replace function for fetch calls and standard strings
    content = content.replace(/(['"`])http:\/\/localhost:3000(.*?)(\1)/g, (match, quote, rest) => {
        return `\`\${import.meta.env.VITE_API_URL}${rest}\``;
    });

    content = content.replace(/(['"`])http:\/\/localhost:(3001|4000)(.*?)(\1)/g, (match, quote, port, rest) => {
        return `\`\${import.meta.env.VITE_INVENTORY_URL}${rest}\``;
    });

    // Fix href="..." that were converted to href=`...`
    content = content.replace(/href=\`\$\{import\.meta\.env\.(.*?)\}(.*?)\`/g, 'href={`\${import.meta.env.$1}$2`}');

    if (content !== original) {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`Updated: ${filePath}`);
    }
}

function walkDir(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            walkDir(fullPath);
        } else if (fullPath.endsWith('.js') || fullPath.endsWith('.jsx')) {
            replaceInFile(fullPath);
        }
    }
}

walkDir(directoryPath);
console.log('Done!');
