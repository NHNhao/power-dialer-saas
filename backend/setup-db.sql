-- Crear usuario y base de datos
CREATE USER dialer_owner WITH PASSWORD 'N17z5284a2025';
CREATE DATABASE dialer_saas OWNER dialer_owner;

-- Otorgar permisos
GRANT ALL PRIVILEGES ON DATABASE dialer_saas TO dialer_owner;
