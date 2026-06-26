import React, { useState } from 'react';
import { uploadData } from 'aws-amplify/storage';
import { generateClient } from 'aws-amplify/api';
import type { Schema } from '../amplify/data/resource';

const client = generateClient<Schema>();

export function MediaUpload() {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [uploaderName, setUploaderName] = useState('');
  const [message, setMessage] = useState('');

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setErrorMessage('');
    setSuccessMessage('');
    setUploadProgress(0);

    try {
      // Generate unique key for the file
      const uniqueKey = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
      
      console.log(`Uploading: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);

      // Upload to S3 with progress tracking
      const result = await uploadData({
        path: `media/${uniqueKey}`,
        data: file,
        options: {
          contentType: file.type,
          // Track upload progress
          onProgress: ({ transferredBytes, totalBytes }) => {
            if (totalBytes) {
              const progress = Math.round((transferredBytes / totalBytes) * 100);
              setUploadProgress(progress);
            }
          },
          // Use accelerated endpoint for faster uploads
          useAccelerateEndpoint: true,
        }
      }).result;

      // Save metadata to database
      await client.models.MediaItem.create({
        fileName: file.name,
        fileKey: result.path,
        fileType: file.type,
        fileSize: file.size,
        uploaderName: uploaderName || undefined,
        message: message || undefined,
        uploadStatus: 'completed',
      });

      setSuccessMessage(`✅ ${file.name} uploaded successfully!`);
      
      // Reset form
      setUploaderName('');
      setMessage('');
      (event.target as HTMLInputElement).value = '';
      
    } catch (error: any) {
      console.error('Upload error:', error);
      setErrorMessage(error.message || 'Upload failed. Please try again.');
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  return (
    <div className="p-6 max-w-md mx-auto bg-white rounded-xl shadow-lg space-y-4">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-800 mb-2">📸 Share Wedding Moments</h2>
        <p className="text-gray-600 text-sm">Upload photos & videos of any size!</p>
      </div>

      {/* Optional guest info */}
      <div className="space-y-3">
        <input
          type="text"
          placeholder="Your name (optional)"
          value={uploaderName}
          onChange={(e) => setUploaderName(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          disabled={isUploading}
        />
        
        <textarea
          placeholder="Add a message (optional)"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={2}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          disabled={isUploading}
        />
      </div>

      {/* File upload */}
      <div className="space-y-3">
        <input 
          type="file" 
          accept="image/*,video/*" 
          onChange={handleFileChange}
          disabled={isUploading}
          className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 disabled:opacity-50"
        />
        
        {/* Upload progress */}
        {isUploading && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm text-blue-600">
              <span>Uploading...</span>
              <span>{uploadProgress}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              ></div>
            </div>
          </div>
        )}
      </div>

      {/* Messages */}
      {errorMessage && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md">
          <p className="text-red-700 text-sm font-medium">❌ {errorMessage}</p>
        </div>
      )}
      
      {successMessage && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-md">
          <p className="text-green-700 text-sm font-medium">{successMessage}</p>
        </div>
      )}

      {/* Info */}
      <div className="text-xs text-gray-500 text-center">
        <p>✨ No size limits • All formats supported</p>
        <p>📱 Photos, videos, RAW files welcome!</p>
      </div>
    </div>
  );
}
