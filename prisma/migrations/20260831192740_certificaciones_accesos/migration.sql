-- MIGRACIÓN PENDIENTE DE APLICAR.
-- Generada sin conexión a ninguna base de datos (gate de seguridad: DATABASE_URL
-- del .env local apunta a un host remoto, no localhost/127.0.0.1). El SQL fue
-- verificado localmente con `prisma migrate diff --from-empty --to-schema` (que
-- no requiere conexión a BD) y luego recortado a mano a las dos tablas nuevas.
-- Se aplicará en el deploy con `prisma migrate deploy`.
--
-- ⚠️ NUNCA correr `prisma migrate dev` contra la BD compartida hasta baselinear
-- (las tablas preexistentes no están en el historial de migraciones y Prisma
-- propondrá RESETEAR la base). Aplicar SOLO con `prisma migrate deploy`.
-- Ver prisma/migrations/README.md para el detalle y el camino de baseline.

-- CreateTable
CREATE TABLE `sth_certificaciones_accesos` (
    `cuil` CHAR(13) NOT NULL,
    `nivel` VARCHAR(191) NOT NULL,
    `verIncidencia` BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (`cuil`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sth_certificaciones_contratos` (
    `cuil` CHAR(13) NOT NULL,
    `contratoId` INTEGER NOT NULL,

    PRIMARY KEY (`cuil`, `contratoId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sth_certificaciones_accesos` ADD CONSTRAINT `sth_certificaciones_accesos_cuil_fkey` FOREIGN KEY (`cuil`) REFERENCES `sth_usuarios`(`cuil`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sth_certificaciones_contratos` ADD CONSTRAINT `sth_certificaciones_contratos_cuil_fkey` FOREIGN KEY (`cuil`) REFERENCES `sth_usuarios`(`cuil`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sth_certificaciones_contratos` ADD CONSTRAINT `sth_certificaciones_contratos_contratoId_fkey` FOREIGN KEY (`contratoId`) REFERENCES `sth_contratos`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
