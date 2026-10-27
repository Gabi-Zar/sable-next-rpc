<script lang="ts">
  import AuthPage from '#lib/features/auth/shared/AuthPage.svelte';
  import AuthStatusSlot from '#lib/features/auth/shared/AuthStatusSlot.svelte';
  import '#lib/features/auth/shared/auth-card.css';
  import Button from '#lib/ui/primitives/Button.svelte';
  import FormActions from '#lib/ui/primitives/FormActions.svelte';
  import FormField from '#lib/ui/primitives/FormField.svelte';
  import TextInput from '#lib/ui/primitives/TextInput.svelte';
  import PasswordField from '#lib/features/auth/shared/PasswordField.svelte';

  interface Props {
    endpoint: string;
    onAuthenticated: () => void;
  }

  let { endpoint, onAuthenticated }: Props = $props();
  let username = $state('');
  let password = $state('');
  let error = $state<string | null>(null);
  let submitting = $state(false);

  async function submit(): Promise<void> {
    submitting = true;
    error = null;
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: { Authorization: `Basic ${btoa(`${username}:${password}`)}` },
      });
      if (!response.ok) {
        error =
          response.status === 429
            ? 'Too many attempts. Try again shortly.'
            : 'Invalid username or password.';
        return;
      }
      password = '';
      onAuthenticated();
    } catch {
      error = 'The server could not be reached.';
    } finally {
      submitting = false;
    }
  }
</script>

<AuthPage hasLoggedInBefore={false} title="Sign in to Sable">
  <form
    class="server-login auth-card-surface login-form"
    novalidate
    onsubmit={(event) => {
      event.preventDefault();
      void submit();
    }}
  >
    <p>This Sable server requires its configured account before Matrix login.</p>
    <FormField dense fieldId="username" label="Username">
      <TextInput
        id="username"
        bind:value={username}
        autocomplete="username"
        required
        disabled={submitting}
      />
    </FormField>
    <FormField dense fieldId="password" label="Password">
      <PasswordField bind:value={password} disabled={submitting} />
    </FormField>
    <AuthStatusSlot message={error} />
    <FormActions>
      <Button type="submit" variant="primary" loading={submitting}>
        {submitting ? 'Signing in…' : 'Sign in'}
      </Button>
    </FormActions>
  </form>
</AuthPage>

<style>
  .server-login {
    margin: 0 auto;
    max-width: 24rem;
  }
</style>
