const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🤖 Discord YouTube Bot Setup');
console.log('============================\n');

// Check if config.js exists
if (!fs.existsSync('./config.js')) {
    console.log('📝 Creating config.js from template...');
    
    if (fs.existsSync('./config.example.js')) {
        fs.copyFileSync('./config.example.js', './config.js');
        console.log('✅ config.js created! Please edit it with your bot token.\n');
    } else {
        console.log('❌ config.example.js not found!\n');
    }
} else {
    console.log('✅ config.js already exists.\n');
}

// Check for required system dependencies
console.log('🔍 Checking system dependencies...\n');

// Check for Node.js version
try {
    const nodeVersion = process.version;
    console.log(`✅ Node.js: ${nodeVersion}`);
    
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
    if (majorVersion < 16) {
        console.log('⚠️  Warning: Node.js 16.9.0 or higher is recommended');
    }
} catch (error) {
    console.log('❌ Node.js version check failed');
}

// Check for FFmpeg
try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    console.log('✅ FFmpeg: Available');
} catch (error) {
    console.log('❌ FFmpeg: Not found or not in PATH');
    console.log('   Please install FFmpeg: https://ffmpeg.org/download.html');
}

// Check for yt-dlp (optional - youtube-dl-exec will auto-install)
try {
    execSync('yt-dlp --version', { stdio: 'ignore' });
    console.log('✅ yt-dlp: Available');
} catch (error) {
    console.log('ℹ️  yt-dlp: Not found (will be auto-installed by youtube-dl-exec)');
}

console.log('\n📋 Next Steps:');
console.log('1. Edit config.js with your Discord bot token');
console.log('2. Install missing system dependencies (FFmpeg, yt-dlp)');
console.log('3. Run: npm start');
console.log('\n📖 For detailed instructions, see README.md');
