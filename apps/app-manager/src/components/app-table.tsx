"use client";

import { useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, RotateCcw, Trash } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { api } from "~/trpc/react";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "./ui/form";
import { Input } from "./ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";

const updateAppSchema = z.object({
  name: z.string().min(1).max(64),
  enabled: z.boolean(),
});
function AppRow({
  app,
}: {
  app: {
    id: string;
    name: string;
    enabled: boolean | null;
    secretKey: string;
  };
}) {
  const utils = api.useUtils();
  const updateForm = useForm<z.infer<typeof updateAppSchema>>({
    resolver: zodResolver(updateAppSchema),
    defaultValues: {
      name: app.name,
      enabled: app.enabled ?? false,
    },
  });

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);

  const deleteFormSchema = useMemo(() => {
    return z.object({
      name: z.literal(app.name),
    });
  }, [app]);

  const deleteForm = useForm<z.infer<typeof deleteFormSchema>>({
    resolver: zodResolver(deleteFormSchema),
    defaultValues: {
      name: "",
    },
  });

  const delApp = api.main.deleteApp.useMutation({
    onSuccess() {
      void utils.main.listApps.invalidate();
    },
  });
  const updApp = api.main.updateApp.useMutation({
    onSuccess() {
      void utils.main.listApps.invalidate();
    },
  });
  const regenAppSecret = api.main.regenerateKey.useMutation({
    onSuccess() {
      void utils.main.listApps.invalidate();
    },
  });

  const onSubmit = (values: z.infer<typeof updateAppSchema>) => {
    updApp.mutate({
      id: app.id,
      ...values,
    });
    setUpdateOpen(false);
  };

  const onDelete = (values: z.infer<typeof deleteFormSchema>) => {
    if (values.name !== app.name) {
      return;
    }
    delApp.mutate(app);
    setDeleteOpen(false);
  };

  return (
    <TableRow key={app.id}>
      <TableCell>{app.id}</TableCell>
      <TableCell>{app.name}</TableCell>
      <TableCell>{app.enabled ? "Yes" : "No"}</TableCell>
      <TableCell className="">
        <div className="bg-white rounded hover:bg-background p-1 w-fit">
          <button
            className="opacity-0 hover:opacity-100 font-mono"
            onClick={() => {
              void navigator.clipboard.writeText(app.secretKey);
            }}
          >
            {app.secretKey}
          </button>
        </div>
      </TableCell>
      <TableCell className="flex gap-2">
        <Dialog open={updateOpen} onOpenChange={setUpdateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Pencil />
              <span className="sr-only">Update Application</span>
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add application</DialogTitle>
            </DialogHeader>
            <Form {...updateForm}>
              <form onSubmit={updateForm.handleSubmit(onSubmit)}>
                <FormField
                  control={updateForm.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>App Name</FormLabel>
                      <FormControl>
                        <Input placeholder="my-sinkr-app" {...field} />
                      </FormControl>
                      <FormDescription>
                        This is your public display name.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={updateForm.control}
                  name="enabled"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel>Enabled</FormLabel>
                        <FormDescription>
                          Whether the app is enabled.
                        </FormDescription>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter>
                  <Button
                    variant={"outline"}
                    onClick={(e) => {
                      e.preventDefault();
                      setUpdateOpen(false);
                      updateForm.reset();
                    }}
                  >
                    Cancel
                  </Button>
                  <Button type="submit">Update App</Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
        <Button
          onClick={() => {
            regenAppSecret.mutate(app);
          }}
        >
          <RotateCcw />
          <span className="sr-only">Regenerate Secret Key</span>
        </Button>
        <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <DialogTrigger asChild>
            <Button>
              <Trash />
              <span className="sr-only">Delete Application</span>
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete application</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete this app?
              </DialogDescription>
            </DialogHeader>
            <Form {...deleteForm}>
              <form onSubmit={deleteForm.handleSubmit(onDelete)}>
                <FormField
                  control={deleteForm.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>App Name</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormDescription>
                        Type your app name to confirm deletion.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter>
                  <Button
                    variant={"outline"}
                    onClick={(e) => {
                      e.preventDefault();
                      setDeleteOpen(false);
                      deleteForm.reset();
                    }}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" variant={"destructive"}>
                    Delete App
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </TableCell>
    </TableRow>
  );
}

export function ApplicationTable() {
  const apps = api.main.listApps.useInfiniteQuery(
    {},
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
    },
  );

  const flatApps = useMemo(() => {
    if (!apps.data) {
      return [];
    }
    return apps.data.pages.flatMap((page) => page.items);
  }, [apps]);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>ID</TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Enabled</TableHead>
          <TableHead>Secret Key</TableHead>
          <TableHead>Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {flatApps.map((app) => {
          return <AppRow key={app.id} app={app} />;
        })}
      </TableBody>
    </Table>
  );
}
