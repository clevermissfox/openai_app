import OpenAI from "openai";
import Microphone from "node-microphone";
import * as Speaker from 'play-sound';
import * as fs from 'node:fs';
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import axios from "axios";
import readline from "readline";
import FormData from "form-data";
import dotenv from 'dotenv'
dotenv.config();
// ******speaker and fs dependancies wont install****** \\

// Set the path for FFmpeg, used for audio processing
ffmpeg.setFfmpegPath(ffmpegPath);

console.log('hi from ttschat.js')

// Initialize OpenAI API client with the provided API key
const secretKey = process.env.OPENAI_API_KEY;
const openai = new OpenAI({
  apiKey: secretKey,
});

// Variables to store chat history and other components
let chatHistory = []; // To store the conversation history
let mic, outputFile, micStream, rl; // Microphone, output file, microphone stream, and readline interface

// Function to set up the readline interface for user input
const setupReadlineInterface = () => {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true, // Make sure the terminal can capture keypress events
    });
  
    readline.emitKeypressEvents(process.stdin, rl);
  
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
  
    // Handle keypress events
    process.stdin.on("keypress", (str, key) => {
      if (
        key &&
        (key.name.toLowerCase() === "return" ||
          key.name.toLowerCase() === "enter")
      ) {
        if (micStream) {
          stopRecordingAndProcess();
        } else {
          startRecording();
        }
      } else if (key && key.ctrl && key.name === "c") {
        process.exit(); // Handle ctrl+c for exiting
      } else if (key) {
        console.log("Exiting application...");
        process.exit(0);
      }
    });
  
    console.log("Press Enter when you're ready to start speaking.");
  };
  
  // Function to start recording audio from the microphone
  const startRecording = () => {
    mic = new Microphone();
    outputFile = fs.createWriteStream("output.wav");
    micStream = mic.startRecording();
  
    // Write incoming data to the output file
    micStream.on("data", (data) => {
      outputFile.write(data);
    });
  
    // Handle microphone errors
    micStream.on("error", (error) => {
      console.error("Error: ", error);
    });
  
    console.log("Recording... Press Enter to stop");
  };
  
  // Function to stop recording and process the audio
  const stopRecordingAndProcess = () => {
    mic.stopRecording();
    outputFile.end();
    console.log(`Recording stopped, processing audio...`);
    transcribeAndChat(); // Transcribe the audio and initiate chat
  };
  
  // Default voice setting for text-to-speech
  const inputVoice = "echo"; // https://platform.openai.com/docs/guides/text-to-speech/voice-options
  const inputModel = "tts-1"; // https://platform.openai.com/docs/guides/text-to-speech/audio-quality
  
  // Function to convert text to speech and play it using Speaker
  async function streamedAudio(
    inputText,
    model = inputModel,
    voice = inputVoice
  ) {
    const url = "https://api.openai.com/v1/audio/speech";
    const headers = {
      Authorization: `Bearer ${secretKey}`, // API key for authentication
    };
  
    const data = {
      model: model,
      input: inputText,
      voice: voice,
      response_format: "mp3",
    };
  
    try {
      // Make a POST request to the OpenAI audio API
      const response = await axios.post(url, data, {
        headers: headers,
        responseType: "stream",
      });
  
      // Configure speaker settings
      const speaker = new Speaker({
        channels: 2, // Stereo audio
        bitDepth: 16,
        sampleRate: 44100,
      });
  
      // Convert the response to the desired audio format and play it
      ffmpeg(response.data)
        .toFormat("s16le")
        .audioChannels(2)
        .audioFrequency(44100)
        .pipe(speaker);
    } catch (error) {
      // Handle errors from the API or the audio processing
      if (error.response) {
        console.error(
          `Error with HTTP request: ${error.response.status} - ${error.response.statusText}`
        );
      } else {
        console.error(`Error in streamedAudio: ${error.message}`);
      }
    }
  }
  
  // Function to transcribe audio to text and send it to the chatbot
  async function transcribeAndChat() {
    const filePath = "output.wav";
    // note that the file size limitations are 25MB for Whisper
  
    // Prepare form data for the transcription request
    const form = new FormData();
    form.append("file", fs.createReadStream(filePath));
    form.append("model", "whisper-1");
    form.append("response_format", "text");
  
    try {
      // Post the audio file to OpenAI for transcription
      const transcriptionResponse = await axios.post(
        "https://api.openai.com/v1/audio/transcriptions",
        form,
        {
          headers: {
            ...form.getHeaders(),
            Authorization: `Bearer ${secretKey}`,
          },
        }
      );
  
      // Extract transcribed text from the response
      const transcribedText = transcriptionResponse.data;
      console.log(`>> You said: ${transcribedText}`);
  
      // Prepare messages for the chatbot, including the transcribed text
      const messages = [
        {
          role: "system",
          content:
            "You are a helpful assistant providing concise responses in at most two sentences.",
        },
        ...chatHistory,
        { role: "user", content: transcribedText },
      ];
  
      // Send messages to the chatbot and get the response
      const chatResponse = await openai.chat.completions.create({
        messages: messages,
        model: "gpt-3.5-turbo",
      });
  
      // Extract the chat response.
      const chatResponseText = chatResponse.choices[0].message.content;
  
      // Update chat history with the latest interaction
      chatHistory.push(
        { role: "user", content: transcribedText },
        { role: "assistant", content: chatResponseText }
      );
  
      // Convert the chat response to speech and play + log it to the terminal
      await streamedAudio(chatResponseText);
      console.log(`>> Assistant said: ${chatResponseText}`);
  
      // Reset microphone stream and prompt for new recording
      micStream = null;
      console.log("Press Enter to speak again, or any other key to quit.\n");
    } catch (error) {
      // Handle errors from the transcription or chatbot API
      if (error.response) {
        console.error(
          `Error: ${error.response.status} - ${error.response.statusText}`
        );
      } else {
        console.error("Error:", error.message);
      }
    }
  }
  
  // Initialize the readline interface
  setupReadlineInterface();