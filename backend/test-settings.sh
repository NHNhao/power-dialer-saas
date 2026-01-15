#!/usr/bin/env bash

# Script para probar los nuevos endpoints de admin-settings

API_URL="http://localhost:3001"

echo "=== Testing Admin Settings Endpoints ==="

# 1. Crear cuenta de prueba
echo -e "\n1. Registrando nueva cuenta..."
REGISTER=$(curl -s -X POST "$API_URL/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "tenant_name": "Test Company",
    "admin_username": "testadmin",
    "admin_name": "Test Admin",
    "admin_password": "password123"
  }')

echo "$REGISTER" | jq .
TOKEN=$(echo "$REGISTER" | jq -r '.token')
USER_ID=$(echo "$REGISTER" | jq -r '.user.user_id')

echo "Token: $TOKEN"
echo "User ID: $USER_ID"

# 2. GET /admin/profile
echo -e "\n2. Obteniendo perfil del usuario..."
curl -s -X GET "$API_URL/admin/profile" \
  -H "Authorization: Bearer $TOKEN" | jq .

# 3. PUT /admin/profile (cambiar nombre y email)
echo -e "\n3. Actualizando perfil (nombre y email)..."
UPDATE=$(curl -s -X PUT "$API_URL/admin/profile" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "Test Admin Updated",
    "email": "testadmin@example.com"
  }')

echo "$UPDATE" | jq .
VERIFICATION_CODE=$(echo "$UPDATE" | jq -r '.verification_code')

# 4. POST /admin/verify-email
echo -e "\n4. Verificando email con código: $VERIFICATION_CODE..."
curl -s -X POST "$API_URL/admin/verify-email" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"code\": \"$VERIFICATION_CODE\",
    \"new_email\": \"testadmin@example.com\"
  }" | jq .

# 5. POST /admin/change-password
echo -e "\n5. Cambiando contraseña..."
curl -s -X POST "$API_URL/admin/change-password" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "current_password": "password123",
    "new_password": "newpassword123"
  }' | jq .

# 6. Login con nueva contraseña
echo -e "\n6. Intentando login con nueva contraseña..."
curl -s -X POST "$API_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testadmin",
    "password": "newpassword123"
  }' | jq .

echo -e "\n=== Tests Completed ==="
