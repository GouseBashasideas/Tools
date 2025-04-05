require('dotenv').config();
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Ensure upload directory exists
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// Image compression endpoint
app.post('/api/compress', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const { quality, format } = req.body;
    const inputPath = req.file.path;
    const outputFilename = `compressed-${req.file.filename}`;
    const outputPath = path.join('uploads', outputFilename);

    // Process image with sharp
    let imageProcessor = sharp(inputPath);
    
    // Set quality based on format
    const qualityValue = parseInt(quality) || 80;
    
    // Convert format if specified
    if (format && format !== 'auto') {
      imageProcessor = imageProcessor.toFormat(format, {
        quality: qualityValue
      });
    } else {
      // For auto, keep original format but apply quality if JPEG/WebP
      const metadata = await sharp(inputPath).metadata();
      if (metadata.format === 'jpeg' || metadata.format === 'webp') {
        imageProcessor = imageProcessor.jpeg({ quality: qualityValue });
      }
    }

    // Save processed image
    await imageProcessor.toFile(outputPath);

    // Get file stats
    const originalStats = fs.statSync(inputPath);
    const compressedStats = fs.statSync(outputPath);

    // Get image dimensions
    const metadata = await sharp(outputPath).metadata();

    // Prepare response
    const response = {
      original: {
        name: req.file.originalname,
        size: originalStats.size,
        path: `/uploads/${req.file.filename}`,
        dimensions: {
          width: metadata.width,
          height: metadata.height
        }
      },
      compressed: {
        name: outputFilename,
        size: compressedStats.size,
        path: `/uploads/${outputFilename}`,
        format: format === 'auto' ? path.extname(req.file.originalname).slice(1) : format,
        dimensions: {
          width: metadata.width,
          height: metadata.height
        }
      },
      savings: {
        percentage: Math.round(((originalStats.size - compressedStats.size) / originalStats.size) * 100),
        bytes: originalStats.size - compressedStats.size
      }
    };

    res.json(response);

  } catch (error) {
    console.error('Compression error:', error);
    res.status(500).json({ error: 'Image processing failed', details: error.message });
  }
});

// File download endpoint
app.get('/uploads/:filename', (req, res) => {
  const filePath = path.join(__dirname, 'uploads', req.params.filename);
  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).send('File not found');
  }
});

// Cleanup old files (runs every hour)
function cleanupOldFiles() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours ago
  fs.readdir('uploads', (err, files) => {
    if (err) return;
    
    files.forEach(file => {
      const filePath = path.join('uploads', file);
      const stats = fs.statSync(filePath);
      if (stats.isFile() && stats.mtime.getTime() < cutoff) {
        fs.unlinkSync(filePath);
      }
    });
  });
}

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  setInterval(cleanupOldFiles, 60 * 60 * 1000); // Cleanup every hour
});
