import { AdminNav } from "./admin-nav";
import { requireAdminUser } from "@/server/current-user";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdminUser();
  return (
    <div>
      <AdminNav />
      {children}
    </div>
  );
}
