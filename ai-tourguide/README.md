# AI TRAVEL MAI 🎧

Thanks to Rick Steves' Europe audio tours that have accompanied us well for the past few years. But we wonder, if we can have improved the experience!

**IMAGINE** No more long ass audio tours, no more TMI, other than your travel partners sharing unhinged stories, just concise, engaging stories tailored to your interests.

An intelligent tour companion that brings Changi Jewel (for now) to life through personalized storytelling and voice interaction.

**Vision**: A mobile app for seamless, hands-free experiences with continuous conversation flow - no more fumbling with audio players or reading screens while exploring.

## What It Does

- **Voice-Activated Tours**: Use wake word to summon your local Singaporean tour guide to bring your around Jewel Changi
- **AI-Powered Narration**: Get personalized stories about the attractions
- **Local Guide Personalities**: Meet Wei Jie (cheerful Singlish guide), Cheryl (professional historian), or the legendary Sang Nila Utama - each with authentic local accents and storytelling styles
- **Personal Preference Learning**: Import your ChatGPT conversation summaries to automatically understand your interests, travel style, and preferences for tailored content
- **Geofencing Discovery**: Push nearby points of interest
- **Image Analysis**: Upload photos to get instant insights about what you're seeing

## Tech Stack

- **Frontend**: Next.js 15, React 19, Tailwind CSS
- **AI**: OpenAI GPT-4o, OpenAI Agents SDK
- **Voice**: Web Speech API, ElevenLabs integration
- **Knowledge**: Tiny Changi Jewel dataset (0.0000b ;))

## Quick Start

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Add your OPENAI_API_KEY

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to experience the AI tour guide.

## Built for Hackathon

This project demonstrates the potential of AI-powered tourism experiences, combining conversational AI, computer vision, and personalized storytelling to create immersive travel companions.
