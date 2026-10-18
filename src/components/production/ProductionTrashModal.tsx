import { useState } from "react";
import { ArchiveRestore, Trash2 } from "lucide-react";

import type { Project } from "../../clients/domainTypes";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";

const formatDateTime = (value?: number) => value
  ? new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value)
  : "近期";

export const ProductionTrashModal = ({
  isOpen,
  onClose,
  projects,
  busyProjectId,
  onRestore,
  onDelete,
  onEmpty,
}: {
  isOpen: boolean;
  onClose: () => void;
  projects: Project[];
  busyProjectId: string | null;
  onRestore: (project: Project) => Promise<boolean>;
  onDelete: (project: Project) => Promise<boolean>;
  onEmpty: () => Promise<boolean>;
}) => {
  const [pendingAction, setPendingAction] = useState<
    { type: "delete"; project: Project } | { type: "empty" } | null
  >(null);
  const isBusy = busyProjectId !== null;
  const isConfirmingDelete = pendingAction?.type === "delete";

  const close = () => {
    setPendingAction(null);
    onClose();
  };

  const confirmPermanentAction = async () => {
    if (!pendingAction) return;
    const completed = pendingAction.type === "empty"
      ? await onEmpty()
      : await onDelete(pendingAction.project);
    if (completed) setPendingAction(null);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title={pendingAction ? "确认永久删除" : "垃圾箱"}
      size="lg"
      footer={pendingAction ? (
        <>
          <Button variant="secondary" size="sm" disabled={isBusy} onClick={() => setPendingAction(null)}>取消</Button>
          <Button
            variant="danger"
            size="sm"
            isLoading={isBusy}
            onClick={() => void confirmPermanentAction()}
            leftIcon={<Trash2 className="h-4 w-4" />}
          >
            {isConfirmingDelete ? "永久删除" : "清空垃圾箱"}
          </Button>
        </>
      ) : undefined}
    >
      {pendingAction ? (
        <div className="space-y-3 text-sm leading-6 text-gray-600 dark:text-neutral-300">
          <p>
            {isConfirmingDelete
              ? `将永久删除《${pendingAction.project.title}》及其同一来源的垃圾箱副本。`
              : `将永久删除垃圾箱中的全部 ${projects.length} 个制片项目。`}
          </p>
          <p className="font-bold text-red-600 dark:text-red-400">此操作不可恢复。</p>
        </div>
      ) : projects.length === 0 ? (
        <div className="flex min-h-52 flex-col items-center justify-center text-gray-400 dark:text-neutral-500">
          <Trash2 className="mb-3 h-7 w-7" />
          <p className="text-sm font-medium">垃圾箱为空</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm leading-6 text-gray-500 dark:text-neutral-400">已删除的制片项目会保留在这里，恢复后将回到项目库。</p>
            <Button size="sm" variant="danger" disabled={isBusy} leftIcon={<Trash2 className="h-4 w-4" />} onClick={() => setPendingAction({ type: "empty" })}>清空垃圾箱</Button>
          </div>
          <div className="divide-y divide-gray-100 rounded-xl border border-gray-100 dark:divide-neutral-800 dark:border-neutral-800">
            {projects.map((project) => {
              const isProjectBusy = busyProjectId === project.id;
              return (
                <div key={project.id} className="flex items-center justify-between gap-4 p-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-gray-900 dark:text-white">{project.title}</p>
                    <p className="mt-1 text-xs text-gray-400">删除于 {formatDateTime(project.productionTrashedAt)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={isBusy}
                      isLoading={isProjectBusy}
                      leftIcon={<ArchiveRestore className="h-4 w-4" />}
                      onClick={() => void onRestore(project)}
                    >
                      恢复
                    </Button>
                    <Button size="sm" variant="danger" disabled={isBusy} leftIcon={<Trash2 className="h-4 w-4" />} onClick={() => setPendingAction({ type: "delete", project })}>永久删除</Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Modal>
  );
};
