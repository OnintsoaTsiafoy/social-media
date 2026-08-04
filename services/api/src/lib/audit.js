export async function writeAuditLog(db, { userId, action, resourceType, resourceId, requestId, metadata }) {
  await db.auditLog.create({
    data: { userId, action, resourceType, resourceId, requestId, metadata },
  });
}
