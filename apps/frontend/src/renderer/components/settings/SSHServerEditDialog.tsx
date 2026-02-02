/**
 * SSHServerEditDialog - Add/Edit SSH server modal
 *
 * Provides form for configuring SSH server connection details.
 * Includes validation and connection testing before save.
 */
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Wifi, Check, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { useToast } from '../../hooks/use-toast';
import type { SSHServer } from '@shared/types/ssh';

interface SSHServerEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server: SSHServer | null;
  onSaved: () => void;
}

interface FormData {
  name: string;
  host: string;
  port: string;
  user: string;
  identityFile: string;
  pythonPath: string;
}

interface FormErrors {
  name?: string;
  host?: string;
  port?: string;
}

type TestStatus = 'idle' | 'testing' | 'success' | 'error';

export function SSHServerEditDialog({
  open,
  onOpenChange,
  server,
  onSaved
}: SSHServerEditDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();

  const isEditing = !!server;

  const [formData, setFormData] = useState<FormData>({
    name: '',
    host: '',
    port: '22',
    user: '',
    identityFile: '',
    pythonPath: ''
  });

  const [errors, setErrors] = useState<FormErrors>({});
  const [isSaving, setIsSaving] = useState(false);
  const [testStatus, setTestStatus] = useState<TestStatus>('idle');
  const [testError, setTestError] = useState<string | null>(null);

  // Reset form when dialog opens/closes or server changes
  useEffect(() => {
    if (open) {
      if (server) {
        setFormData({
          name: server.name,
          host: server.host,
          port: String(server.port || 22),
          user: server.user || '',
          identityFile: server.identityFile || '',
          pythonPath: server.pythonPath || ''
        });
      } else {
        setFormData({
          name: '',
          host: '',
          port: '22',
          user: '',
          identityFile: '',
          pythonPath: ''
        });
      }
      setErrors({});
      setTestStatus('idle');
      setTestError(null);
    }
  }, [open, server]);

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};

    if (!formData.name.trim()) {
      newErrors.name = t('settings:sshServers.validation.nameRequired');
    }

    if (!formData.host.trim()) {
      newErrors.host = t('settings:sshServers.validation.hostRequired');
    }

    const port = parseInt(formData.port, 10);
    if (formData.port && (isNaN(port) || port < 1 || port > 65535)) {
      newErrors.port = t('settings:sshServers.validation.portInvalid');
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleTestConnection = async () => {
    if (!validateForm()) return;

    setTestStatus('testing');
    setTestError(null);

    // First save the server temporarily to test
    const serverData = {
      name: formData.name.trim(),
      host: formData.host.trim(),
      port: parseInt(formData.port, 10) || 22,
      user: formData.user.trim() || undefined,
      identityFile: formData.identityFile.trim() || undefined,
      pythonPath: formData.pythonPath.trim() || undefined
    };

    // If editing, test existing server
    if (server) {
      const result = await window.electronAPI.testSSHConnection(server.id);
      if (result.success && result.data) {
        if (result.data.success) {
          setTestStatus('success');
        } else {
          setTestStatus('error');
          setTestError(result.data.error || result.data.message);
        }
      } else {
        setTestStatus('error');
        setTestError(result.error || 'Connection test failed');
      }
    } else {
      // For new servers, we need to add it first, test, then remove if not saving
      // For simplicity, just show a message to save first
      const addResult = await window.electronAPI.addSSHServer(serverData);
      if (addResult.success && addResult.data) {
        const testResult = await window.electronAPI.testSSHConnection(addResult.data.id);
        // Remove the temporary server
        await window.electronAPI.removeSSHServer(addResult.data.id);

        if (testResult.success && testResult.data) {
          if (testResult.data.success) {
            setTestStatus('success');
          } else {
            setTestStatus('error');
            setTestError(testResult.data.error || testResult.data.message);
          }
        } else {
          setTestStatus('error');
          setTestError(testResult.error || 'Connection test failed');
        }
      } else {
        setTestStatus('error');
        setTestError(addResult.error || 'Failed to create temporary server for testing');
      }
    }
  };

  const handleSave = async () => {
    if (!validateForm()) return;

    setIsSaving(true);

    const serverData = {
      name: formData.name.trim(),
      host: formData.host.trim(),
      port: parseInt(formData.port, 10) || 22,
      user: formData.user.trim() || undefined,
      identityFile: formData.identityFile.trim() || undefined,
      pythonPath: formData.pythonPath.trim() || undefined
    };

    let result;
    if (isEditing && server) {
      result = await window.electronAPI.updateSSHServer(server.id, serverData);
    } else {
      result = await window.electronAPI.addSSHServer(serverData);
    }

    setIsSaving(false);

    if (result.success) {
      toast({
        title: isEditing
          ? t('settings:sshServers.toast.update.title')
          : t('settings:sshServers.toast.add.title'),
        description: isEditing
          ? t('settings:sshServers.toast.update.description', { name: serverData.name })
          : t('settings:sshServers.toast.add.description', { name: serverData.name }),
      });
      onSaved();
      onOpenChange(false);
    } else {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: result.error || 'Failed to save server',
      });
    }
  };

  const handleInputChange = (field: keyof FormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    // Clear error when user starts typing
    if (errors[field as keyof FormErrors]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
    // Reset test status when form changes
    setTestStatus('idle');
    setTestError(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {isEditing
              ? t('settings:sshServers.dialog.editTitle')
              : t('settings:sshServers.dialog.addTitle')}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? t('settings:sshServers.dialog.editDescription')
              : t('settings:sshServers.dialog.addDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Name */}
          <div className="grid gap-2">
            <Label htmlFor="name">{t('settings:sshServers.fields.name')}</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => handleInputChange('name', e.target.value)}
              placeholder={t('settings:sshServers.placeholders.name')}
              className={errors.name ? 'border-destructive' : ''}
            />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name}</p>
            )}
            <p className="text-xs text-muted-foreground">
              {t('settings:sshServers.hints.name')}
            </p>
          </div>

          {/* Host */}
          <div className="grid gap-2">
            <Label htmlFor="host">{t('settings:sshServers.fields.host')}</Label>
            <Input
              id="host"
              value={formData.host}
              onChange={(e) => handleInputChange('host', e.target.value)}
              placeholder={t('settings:sshServers.placeholders.host')}
              className={errors.host ? 'border-destructive' : ''}
            />
            {errors.host && (
              <p className="text-sm text-destructive">{errors.host}</p>
            )}
            <p className="text-xs text-muted-foreground">
              {t('settings:sshServers.hints.host')}
            </p>
          </div>

          {/* Port */}
          <div className="grid gap-2">
            <Label htmlFor="port">{t('settings:sshServers.fields.port')}</Label>
            <Input
              id="port"
              type="number"
              min="1"
              max="65535"
              value={formData.port}
              onChange={(e) => handleInputChange('port', e.target.value)}
              placeholder={t('settings:sshServers.placeholders.port')}
              className={errors.port ? 'border-destructive' : ''}
            />
            {errors.port && (
              <p className="text-sm text-destructive">{errors.port}</p>
            )}
            <p className="text-xs text-muted-foreground">
              {t('settings:sshServers.hints.port')}
            </p>
          </div>

          {/* Username */}
          <div className="grid gap-2">
            <Label htmlFor="user">{t('settings:sshServers.fields.user')}</Label>
            <Input
              id="user"
              value={formData.user}
              onChange={(e) => handleInputChange('user', e.target.value)}
              placeholder={t('settings:sshServers.placeholders.user')}
            />
            <p className="text-xs text-muted-foreground">
              {t('settings:sshServers.hints.user')}
            </p>
          </div>

          {/* Identity File */}
          <div className="grid gap-2">
            <Label htmlFor="identityFile">{t('settings:sshServers.fields.identityFile')}</Label>
            <Input
              id="identityFile"
              value={formData.identityFile}
              onChange={(e) => handleInputChange('identityFile', e.target.value)}
              placeholder={t('settings:sshServers.placeholders.identityFile')}
            />
            <p className="text-xs text-muted-foreground">
              {t('settings:sshServers.hints.identityFile')}
            </p>
          </div>

          {/* Python Path */}
          <div className="grid gap-2">
            <Label htmlFor="pythonPath">{t('settings:sshServers.fields.pythonPath')}</Label>
            <Input
              id="pythonPath"
              value={formData.pythonPath}
              onChange={(e) => handleInputChange('pythonPath', e.target.value)}
              placeholder={t('settings:sshServers.placeholders.pythonPath')}
            />
            <p className="text-xs text-muted-foreground">
              {t('settings:sshServers.hints.pythonPath')}
            </p>
          </div>

          {/* Test Connection Result */}
          {testStatus !== 'idle' && (
            <div
              className={`flex items-center gap-2 p-3 rounded-lg ${
                testStatus === 'success'
                  ? 'bg-green-500/10 text-green-600'
                  : testStatus === 'error'
                    ? 'bg-destructive/10 text-destructive'
                    : 'bg-muted'
              }`}
            >
              {testStatus === 'testing' && (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>{t('settings:sshServers.testConnection.testing')}</span>
                </>
              )}
              {testStatus === 'success' && (
                <>
                  <Check className="h-4 w-4" />
                  <span>{t('settings:sshServers.testConnection.success')}</span>
                </>
              )}
              {testStatus === 'error' && (
                <>
                  <X className="h-4 w-4" />
                  <span>{testError || t('settings:sshServers.testConnection.failure')}</span>
                </>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={handleTestConnection}
            disabled={isSaving || testStatus === 'testing'}
          >
            {testStatus === 'testing' ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Wifi className="mr-2 h-4 w-4" />
            )}
            {t('settings:sshServers.actions.testConnection')}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            {t('settings:sshServers.actions.cancel')}
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving || testStatus === 'testing'}
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('settings:sshServers.actions.saving')}
              </>
            ) : (
              t('settings:sshServers.actions.save')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
