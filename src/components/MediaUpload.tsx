import React, { useState } from 'react';
import imageCompression from 'browser-image-compression';
import { uploadData } from 'aws-amplify/storage';

export function MediaUpload() {
  const [isUploading, setIsUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setErrorMessage('');

    try {
      let fileToUpload: File | Blob = file;

      // 1. HANDLE IMAGE COMPRESSION
      if (file.type.startsWith('image/')) {
        const options = {
          maxSizeMB: 1.5,          // Target max file size (1.5MB is crisp yet light)
          maxWidthOrHeight: 2560,  // Keep it gorgeous at 2K resolution
          useWebWorker: true,
          initialQuality: 0.85,    // 85% quality maintains high visual fidelity
        };
        
        console.log(`Original size: ${(file.size / 1024 / 1024).toFixed(2)} MB`);
        fileToUpload = await imageCompression(file, options);
        console.log(`Compressed size: ${(fileToUpload.size / 1024 / 1024).toFixed(2)} MB`);
      }

      // 2. HANDLE VIDEO PROTECTION
      if (file.type.startsWith('video/')) {
        const MAX_VIDEO_SIZE = 50 * 1024 * 1024; // 50MB limit
        if (file.size > MAX_VIDEO_SIZE) {
          throw new Error('Video is too large! Please keep clips under 50MB (roughly 30-60 seconds).');
        }
      }

      // 3. UPLOAD TO AMPLIFY S3 STORAGE
      const uniqueKey = `${Date.now()}-${file.name}`;
      await uploadData({
        path: `media/${uniqueKey}`,
        data: fileToUpload,
        options: {
          contentType: file.type, // Ensures S3 serves it correctly to the browser
        }
      });

      alert('Upload successful! 🎉');
    } catch (error: any) {
      setErrorMessage(error.message || 'Something went wrong during the upload.');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="p-6 max-w-sm mx-auto bg-white rounded-xl shadow-md space-y-4">
      <label className="block text-sm font-medium text-gray-700">Share your Wedding Moments</label>
      <input 
        type="file" 
        accept="image/*,video/*" 
        onChange={handleFileChange}
        disabled={isUploading}
        className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-violet-50 file:text-violet-700 hover:file:bg-violet-100"
      />
      {isUploading && <p className="text-blue-500 text-sm">Optimizing and uploading...</p>}
      {errorMessage && <p className="text-red-500 text-sm font-semibold">{errorMessage}</p>}
    </div>
  );
}