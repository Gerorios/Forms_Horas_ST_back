# Endurecimiento de SSH y fail2ban en la VPS (2026-10-01)

**Solo servidor.** Sin cambios de código, DDL ni API. Pedido explícito del usuario
tras una auditoría de seguridad ("sigamos con el plan"). Bitácora §101.

## Por qué

La auditoría encontró bots probando contraseñas contra el SSH de producción
(179.198.99.30), del 2026-08-30 al 2026-10-01:

| Dato | Valor |
|---|---|
| Contraseñas fallidas | 2944 (916 contra root) |
| Usuarios inexistentes probados | 2023 |
| IPs atacantes distintas | 39 (la peor, 1334 intentos) |
| Ingresos con contraseña | 0 |

El SSH aceptaba contraseña y root podía entrar directo: el `PasswordAuthentication
no` de `sshd_config` lo pisaba `sshd_config.d/50-cloud-init.conf` de Hostinger
(`yes`). No había fail2ban.

Antes de cambiar se verificó que nadie dependía de la contraseña: los 206 ingresos
de los logs fueron con la clave de `coworker` (`forms_horas_vps2`), desde 4 IPs.

## Ejecutado (como coworker con sudo)

1. Backup de `/etc/ssh/sshd_config` y `sshd_config.d/` en
   `/root/backup-ssh-20261001-1349/`.
2. Nuevo `/etc/ssh/sshd_config.d/01-endurecimiento.conf` (se lee antes que el de
   Hostinger y en sshd gana el primer valor): `PasswordAuthentication no`,
   `KbdInteractiveAuthentication no`, `PermitRootLogin prohibit-password`,
   `PermitEmptyPasswords no`, `MaxAuthTries 3`, `X11Forwarding no`.
   `sshd -t` OK → `systemctl reload ssh` (no corta sesiones abiertas).
3. `apt-get install fail2ban` (1.0.2) + `/etc/fail2ban/jail.local`: jail `sshd`,
   5 fallos en 10 min → bloqueo 1 h, reincidentes el doble cada vez hasta 1
   semana, `backend = systemd`. Habilitado al arranque.

**No se bloqueó la contraseña de root:** la consola web de Hostinger, que es el
acceso de emergencia sin SSH, la pide. Con el SSH sin contraseñas ya no sirve
para atacar desde internet.

## Verificación

| Chequeo | Resultado |
|---|---|
| Conexión nueva con la clave `forms_horas_vps2` | entra, `sudo` OK |
| Forzar contraseña como `coworker` | `Permission denied (publickey)` |
| Forzar contraseña como `root` | `Permission denied (publickey)` |
| fail2ban | `active`, `enabled`, jail `sshd` |
| El filtro ve los intentos (`journalctl _COMM=sshd`) | 10 fallos reconocidos |
| App (`pm2`) y dominio público | online, 200 |

La instalación no reinició servicios de la app (needrestart los dejó diferidos).

## Qué cambia para las personas

Al servidor se entra **solo con clave SSH**. Quien tenga una copia de
`forms_horas_vps2` (el usuario y, si la usa, Rodrigo) entra igual que antes. Una
IP que falle 5 veces queda bloqueada una hora.

## Rollback

```bash
sudo rm /etc/ssh/sshd_config.d/01-endurecimiento.conf && sudo systemctl reload ssh
sudo systemctl disable --now fail2ban
```

Si alguien queda bloqueado por fail2ban: `sudo fail2ban-client set sshd unbanip <IP>`.
Si se pierde el acceso por SSH: consola web de Hostinger con la contraseña de root.

## Pendientes de la misma auditoría

- La clave cargada en `root` (`claude-code@forms-horas-vps`, huella
  `SHA256:NuDAdq…`) no coincide con ninguna de la PC del usuario: identificar de
  quién es y sacarla si nadie la usa.
- Hacer copia de la clave privada `forms_horas_vps2` (no tiene frase de
  protección) en un lugar seguro.
- La app se alcanza saltando Cloudflare (HTTPS directo a la IP llega al login) y
  nginx registra IPs de Cloudflare, no las reales; el login no tiene límite de
  intentos. Arreglo: `real_ip` de Cloudflare en nginx, limitar 80/443 a sus rangos,
  `limit_req` y `@nestjs/throttler` en el login.
- MySQL `191.101.235.7:3306` abierto a internet: pedir a IT que lo restrinja a la IP
  de la VPS y de la oficina.
- ~~Reinicio pendiente de la VPS~~ HECHO el mismo día, ver abajo. `.env` con permisos
  644 (debería ser 600); `server_tokens off` en nginx.

## Reinicio de la VPS (2026-10-01, 11:33 hora Argentina)

Pedido explícito del usuario ("hacelo ya"), en horario de uso. Activó el kernel
6.8.0-142 (corría el 6.8.0-134, con 8 actualizaciones y `libc6` sin activar).
Antes se verificó que todo arrancara solo: `ssh.socket`, `pm2-root` con la lista
guardada igual a la actual, nginx, fail2ban, ufw, y el contenedor del portal viejo
con `unless-stopped` (siguió apagado).

| Chequeo después | Resultado |
|---|---|
| Corte | menos de 1 minuto |
| Kernel / reinicio pendiente | 6.8.0-142 / no |
| `pm2` back y front | online |
| Dominio `/login` | 200 |
| Backend contra la base (login inexistente) | 401 "Credenciales inválidas" |
| SSH con clave / sin contraseña / fail2ban | OK / `passwordauthentication no` / activo |
