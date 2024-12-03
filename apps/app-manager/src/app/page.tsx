import { SessionProvider } from "next-auth/react";

import { AddAppButton } from "~/components/add-app-button";
import { ApplicationTable } from "~/components/app-table";
import { UserButton } from "~/components/user-button";

export default function Home() {
  return (
    <SessionProvider>
      <nav className="w-full flex justify-end p-4 bg-accent">
        <UserButton />
      </nav>
      <main className="relative h-full w-full flex-1">
        <ApplicationTable />
        <div className="absolute bottom-0 right-0 p-4">
          <AddAppButton />
        </div>
      </main>
    </SessionProvider>
  );
}
