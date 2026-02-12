#!/bin/bash

# Polymarket AI - Configure Groq API Key
# This script helps you add your FREE Groq API key to the project

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🤖 Polymarket AI - Groq API Configuration"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if .env exists
ENV_FILE="src/web-app/bff/.env"

if [ ! -f "$ENV_FILE" ]; then
    echo "❌ .env file not found at $ENV_FILE"
    echo "Creating .env from .env.example..."
    cp "src/web-app/bff/.env.example" "$ENV_FILE"
fi

echo "📍 Configuration file: $ENV_FILE"
echo ""
echo "Current status:"

# Check current API key
CURRENT_KEY=$(grep "GROQ_API_KEY=" "$ENV_FILE" | cut -d'=' -f2)

if [ -z "$CURRENT_KEY" ] || [ "$CURRENT_KEY" = "gsk_get_your_free_key_from_groq_console" ]; then
    echo "   ❌ No valid API key configured"
else
    echo "   ✅ API key found: ${CURRENT_KEY:0:10}...${CURRENT_KEY: -5}"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 How to get a FREE Groq API Key (2 minutes):"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "1. Visit: https://console.groq.com"
echo "2. Sign up (Email, Google, or GitHub - NO CREDIT CARD)"
echo "3. Go to API Keys section"
echo "4. Create new API key"
echo "5. Copy the key (starts with gsk_)"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

read -p "Do you have your API key? (y/n) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    echo "🔑 Enter your Groq API key (starts with gsk_):"
    read -s -p "API Key: " API_KEY
    echo ""
    
    if [[ $API_KEY == gsk_* ]] && [ ${#API_KEY} -gt 20 ]; then
        # Update the .env file
        # Use different delimiter to handle slashes in key
        sed -i '' "s|GROQ_API_KEY=.*|GROQ_API_KEY=$API_KEY|" "$ENV_FILE"
        
        echo ""
        echo "✅ API Key saved!"
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "🚀 Next Steps:"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        echo "1️⃣  Your backend is running?"
        echo "   Kill old process and restart:"
        echo "   $ lsof -ti :5000 | xargs kill -9"
        echo "   $ cd src/web-app/bff && npm run dev"
        echo ""
        echo "2️⃣  Check the logs for:"
        echo "   🌐 Calling Groq API with LLaMA 3.1 70B..."
        echo "   ✅ Groq API response received"
        echo ""
        echo "3️⃣  Open browser and test:"
        echo "   http://localhost:3001"
        echo "   Login: test@polymarket.com / testpass123"
        echo ""
        echo "4️⃣  Ask the AI:"
        echo "   'Should I buy gold futures?'"
        echo "   'What are the trending markets?'"
        echo "   'Give me a crypto trading strategy'"
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        
    else
        echo ""
        echo "❌ Invalid API key format!"
        echo "   - Must start with 'gsk_'"
        echo "   - Must be at least 20 characters"
        echo "   - Example: gsk_4K1M9nzxYaB2cDeFgHiJkLm..."
        echo ""
        exit 1
    fi
else
    echo ""
    echo "⏳ Please get your free API key from:"
    echo "   👉 https://console.groq.com"
    echo ""
    echo "Then run this script again to add it."
    echo ""
    echo "💡 Tips:"
    echo "   • It's completely FREE"
    echo "   • No credit card needed"
    echo "   • 14,400 requests/day limit"
    echo "   • Takes 2 minutes to set up"
    echo ""
    exit 0
fi
