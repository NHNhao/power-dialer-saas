# Admin Settings API Documentation

## Overview
Estos endpoints permiten que los administradores gestionen su perfil, cambien su contraseña y actualicen su email con verificación de seguridad.

## Endpoints

### 1. GET /admin/profile
**Descripción:** Obtiene el perfil del usuario administrador autenticado.

**Headers Requeridos:**
- `Authorization: Bearer {token}`

**Respuesta (200 OK):**
```json
{
  "ok": true,
  "user": {
    "id": "uuid",
    "username": "testadmin",
    "name": "Test Admin",
    "email": "testadmin@example.com",
    "role": "admin",
    "status": "active",
    "created_at": "2026-01-14T..."
  }
}
```

**Errores:**
- `401`: Token inválido o faltante
- `403`: No es administrador
- `404`: Usuario no encontrado

---

### 2. PUT /admin/profile
**Descripción:** Actualiza el nombre y email del usuario. Si el email cambia, envía un código de verificación.

**Headers Requeridos:**
- `Authorization: Bearer {token}`
- `Content-Type: application/json`

**Body:**
```json
{
  "name": "Nuevo Nombre",
  "email": "newemail@example.com"
}
```

**Respuesta (200 OK) - Sin cambio de email:**
```json
{
  "ok": true,
  "message": "profile_updated"
}
```

**Respuesta (200 OK) - Con cambio de email:**
```json
{
  "ok": true,
  "message": "name_updated_email_verification_sent",
  "verification_code": "ABC123"  // Solo para desarrollo, remover en producción
}
```

**Notas:**
- El código de verificación se envía al nuevo email (actualmente solo lo muestra en logs)
- El código expira en 30 minutos
- Si el email es el mismo que el actual, solo se actualiza el nombre

**Errores:**
- `400`: Campos vacíos o faltantes
- `401`: Token inválido
- `403`: No es administrador
- `404`: Usuario no encontrado

---

### 3. POST /admin/verify-email
**Descripción:** Verifica el código de confirmación y actualiza el email del usuario.

**Headers Requeridos:**
- `Authorization: Bearer {token}`
- `Content-Type: application/json`

**Body:**
```json
{
  "code": "ABC123",
  "new_email": "newemail@example.com"
}
```

**Respuesta (200 OK):**
```json
{
  "ok": true,
  "message": "email_verified_and_updated",
  "token": "nuevo.jwt.token",
  "user": {
    "user_id": "uuid",
    "tenant_id": "uuid",
    "role": "admin",
    "username": "testadmin",
    "name": "Test Admin",
    "email": "newemail@example.com"
  }
}
```

**Notas:**
- El código debe coincidir exactamente (case-insensitive convertido a mayúsculas)
- El código no puede estar expirado (máximo 30 minutos)
- Se devuelve un nuevo token JWT con el email actualizado
- Se elimina el registro de verificación después de verificar

**Errores:**
- `400`: Código expirado, inválido o email no coincide
- `401`: Token inválido
- `403`: No es administrador

---

### 4. POST /admin/change-password
**Descripción:** Cambia la contraseña del usuario. Requiere la contraseña actual.

**Headers Requeridos:**
- `Authorization: Bearer {token}`
- `Content-Type: application/json`

**Body:**
```json
{
  "current_password": "passwordActual123",
  "new_password": "nuevaPassword123"
}
```

**Respuesta (200 OK):**
```json
{
  "ok": true,
  "message": "password_changed"
}
```

**Validaciones:**
- La contraseña actual debe ser correcta
- La nueva contraseña debe tener mínimo 6 caracteres
- Ambos campos son requeridos

**Errores:**
- `400`: Campos vacíos, contraseña muy corta
- `401`: Contraseña actual inválida o token inválido
- `403`: No es administrador
- `404`: Usuario no encontrado
- `500`: Error al hashear la contraseña

**Notas:**
- La contraseña se hashea con bcrypt
- Se registra en el audit_log como 'password_changed'
- El usuario puede hacer login inmediatamente con la nueva contraseña

---

## Database Schema

### Tabla: email_verifications
```sql
CREATE TABLE public.email_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  new_email VARCHAR(255) NOT NULL,
  verification_code VARCHAR(10) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT now(),
  UNIQUE(user_id)
);
```

**Cambios en tabla users:**
- Se agregó columna `email VARCHAR(255)` si no existía

---

## Flow Completo de Cambio de Email

1. **Usuario solicita cambio de email:**
   ```
   PUT /admin/profile
   {
     "name": "New Name",
     "email": "newemail@example.com"
   }
   ```

2. **Backend:**
   - Valida que el email sea diferente al actual
   - Genera código de verificación de 6 caracteres
   - Lo guarda en `email_verifications` con expiración 30 minutos
   - Envía email con el código (actualmente solo en logs)
   - Retorna el código (solo para testing)

3. **Usuario recibe el código y lo ingresa:**
   ```
   POST /admin/verify-email
   {
     "code": "ABC123",
     "new_email": "newemail@example.com"
   }
   ```

4. **Backend:**
   - Valida que el código sea correcto y no esté expirado
   - Actualiza el email en la tabla `users`
   - Elimina el registro de verificación
   - Devuelve nuevo JWT token con email actualizado

---

## Frontend Implementation (admin-settings.js)

La página `/admin-settings` incluye:

### Sección 1: Información de Cuenta
- Username (read-only)
- Nombre Completo (editable)
- Email (editable)
- Botón "Guardar Cambios"
- Si cambia email, muestra sección de verificación

### Sección 2: Cambiar Contraseña
- Contrasena Actual (required)
- Nueva Contraseña (required)
- Confirmar Contraseña (required)
- Validación de coincidencia y longitud mínima
- Botón "Cambiar Contraseña"

### Sección 3: Verificar Email (condicional)
- Solo aparece si se cambió el email
- Campo para ingresar código de verificación
- Muestra email pendiente de verificación
- Botón "Verificar Email"

---

## Testing

### Con curl:
```bash
# Registrar
TOKEN=$(curl -s -X POST http://localhost:3001/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "tenant_name": "Test Co",
    "admin_username": "admin1",
    "admin_name": "Admin User",
    "admin_password": "pass123"
  }' | jq -r '.token')

# Ver perfil
curl -s -X GET http://localhost:3001/admin/profile \
  -H "Authorization: Bearer $TOKEN" | jq .

# Actualizar perfil
curl -s -X PUT http://localhost:3001/admin/profile \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "Updated Name",
    "email": "new@example.com"
  }' | jq .

# Cambiar contraseña
curl -s -X POST http://localhost:3001/admin/change-password \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "current_password": "pass123",
    "new_password": "newpass123"
  }' | jq .
```

### En el Frontend:
1. Login con credenciales de admin
2. Click en botón "⚙️ Settings" en la esquina superior derecha
3. Editar nombre y/o email
4. Click en "Guardar Cambios"
5. Si cambió email, ingresar código de verificación
6. Para cambiar contraseña, click en "Cambiar Contraseña"
7. Ingresar contraseña actual y nueva contraseña (2x)

---

## Notas de Seguridad

### Implementado ✅
- Contraseñas hasheadas con bcrypt
- JWT tokens para autenticación
- Verificación de rol (admin only)
- Código de verificación de 6 caracteres (32,475,456 combinaciones)
- Expiración de código (30 minutos)
- Validación de longitud de contraseña

### TODO para Producción
- [ ] Implementar envío real de emails (SendGrid, AWS SES, etc.)
- [ ] Rate limiting en endpoints de autenticación
- [ ] Logs auditados de cambios de contraseña/email
- [ ] Notificaciones por email de cambios de seguridad
- [ ] Two-Factor Authentication (2FA)
- [ ] Cambiar JWT_SECRET en .env con valor seguro
- [ ] HTTPS en producción
- [ ] Implementar email confirmation antes de usar nuevo email
- [ ] Agregar campo de "last_login" para auditoría

---

## Cambios Realizados

### Backend (index.js)
- Agregado endpoint `GET /admin/profile`
- Agregado endpoint `PUT /admin/profile`
- Agregado endpoint `POST /admin/verify-email`
- Agregado endpoint `POST /admin/change-password`
- Actualizado login para incluir `email` en JWT token
- Actualizado registro para incluir `email` en JWT token

### Frontend (pages/admin-settings.js)
- Nueva página `/admin-settings`
- Formulario de perfil (nombre, email, username read-only)
- Formulario de cambio de contraseña
- Flujo de verificación de email

### Database (schema.sql)
- Nueva tabla `email_verifications` para códigos temporales
- Se ejecutó comando SQL para crear tabla en PostgreSQL

### Navegación
- Botón de Settings en admin-dashboard lleva a `/admin-settings`
- Botón de volver en admin-settings lleva a `/admin-dashboard`
- Logout disponible desde `/admin-settings`

