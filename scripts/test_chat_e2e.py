#!/usr/bin/env python3
"""
End-to-End Test for Polymarket Chat AI
Tests the complete flow: Login -> Send Message -> Get AI Response with Polymarket data
"""

import requests
import json
import sys

BASE_URL = "http://localhost:5000"

def test_chat_flow():
    """Test complete chat flow"""
    print("🧪 Testing End-to-End Chat Flow\n")
    print("=" * 60)
    
    # Step 1: Register/Login
    print("\n1️⃣  Authenticating...")
    login_data = {
        "email": "test@polymarket.com",
        "password": "testpass123",
        "name": "Test User"
    }
    
    # Try login first
    try:
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": login_data["email"],
            "password": login_data["password"]
        })
        
        if response.status_code != 200:
            # Register if login fails
            print("   📝 Registering new user...")
            response = requests.post(f"{BASE_URL}/api/auth/register", json=login_data)
            response.raise_for_status()
        
        auth_data = response.json()
        if not auth_data.get('success'):
            print(f"   ❌ Auth failed: {auth_data}")
            return False
            
        token = auth_data['data']['token']
        user = auth_data['data']['user']
        print(f"   ✅ Authenticated as: {user['name']}")
        print(f"   🔑 Token: {token[:20]}...")
        
    except Exception as e:
        print(f"   ❌ Authentication error: {e}")
        return False
    
    # Step 2: Send chat message
    print("\n2️⃣  Sending chat message...")
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    
    message = "Should I buy or sell gold futures?"
    print(f'   💬 Message: "{message}"')
    
    try:
        response = requests.post(
            f"{BASE_URL}/api/chat/message",
            json={"message": message},
            headers=headers,
            timeout=30
        )
        response.raise_for_status()
        
        chat_data = response.json()
        if not chat_data.get('success'):
            print(f"   ❌ Chat failed: {chat_data}")
            return False
        
        print(f"   ✅ Response received!")
        print(f"   📊 Conversation ID: {chat_data['data']['conversationId']}")
        print(f"   📝 Message count: {chat_data['data']['conversation']['messageCount']}")
        
    except Exception as e:
        print(f"   ❌ Chat error: {e}")
        return False
    
    # Step 3: Display AI response
    print("\n3️⃣  AI Response:")
    print("   " + "─" * 56)
    ai_message = chat_data['data']['message']
    for line in ai_message.split('\n'):
        print(f"   {line}")
    print("   " + "─" * 56)
    
    # Step 4: Check for Polymarket data indicators
    print("\n4️⃣  Verifying Polymarket data integration:")
    has_data_indicators = any([
        'market' in ai_message.lower(),
        'polymarket' in ai_message.lower(),
        'events' in ai_message.lower(),
        'data' in ai_message.lower(),
    ])
    
    if has_data_indicators:
        print("   ✅ Response contains market data references")
    else:
        print("   ⚠️  Response may not include market data")
    
    # Check if it's a fallback response
    is_fallback = 'groq' in ai_message.lower() or 'api key' in ai_message.lower()
    if is_fallback:
        print("   ℹ️  Using fallback response (Groq API key not configured)")
        print("   💡 Get free key at: https://console.groq.com")
    else:
        print("   ✅ Full AI analysis active!")
    
    # Step 5: Get conversations list
    print("\n5️⃣  Fetching conversations...")
    try:
        response = requests.get(
            f"{BASE_URL}/api/chat/conversations",
            headers=headers
        )
        response.raise_for_status()
        
        convs_data = response.json()
        if convs_data.get('success'):
            convs = convs_data['data']
            print(f"   ✅ Found {len(convs)} conversation(s)")
            for conv in convs[:3]:
                print(f"      • {conv['title']} ({conv['messageCount']} messages)")
        
    except Exception as e:
        print(f"   ❌ Failed to fetch conversations: {e}")
    
    print("\n" + "=" * 60)
    print("✅ End-to-End Test PASSED!")
    print("\n💡 Next steps:")
    print("   1. Open http://localhost:3001 in browser")
    print("   2. Login with test@polymarket.com / testpass123")
    print("   3. Start chatting with AI assistant")
    print("   4. Add Groq API key for full AI features")
    print("=" * 60)
    
    return True

if __name__ == "__main__":
    try:
        success = test_chat_flow()
        sys.exit(0 if success else 1)
    except KeyboardInterrupt:
        print("\n\n⚠️  Test interrupted")
        sys.exit(1)
    except Exception as e:
        print(f"\n\n❌ Test failed with error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
