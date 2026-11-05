using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;

static class CosmicKeys {
  static int Main(string[] args) {
    byte[] input = null, result = null, output = null;
    try {
      if (args.Length != 1 || args[0] != "protect" && args[0] != "unprotect") throw new InvalidOperationException();
      string text = Console.ReadLine();
      if (text == null || text.Length == 0 || text.Length > 65536) throw new InvalidOperationException();
      input = Convert.FromBase64String(text);
      if (Convert.ToBase64String(input) != text) throw new InvalidOperationException();
      // Shared entropy keeps this format separate from other CurrentUser DPAPI uses.
      byte[] entropy = Encoding.UTF8.GetBytes("cosmic-account-key-v1");
      result = args[0] == "protect"
        ? ProtectedData.Protect(input, entropy, DataProtectionScope.CurrentUser)
        : ProtectedData.Unprotect(input, entropy, DataProtectionScope.CurrentUser);
      output = Encoding.ASCII.GetBytes(Convert.ToBase64String(result) + "\n");
      Stream stdout = Console.OpenStandardOutput();
      stdout.Write(output, 0, output.Length);
      stdout.Flush();
      return 0;
    } catch (CryptographicException) {
      Console.Error.WriteLine("protection_failed");
      return 1;
    } catch (Exception) {
      Console.Error.WriteLine("key_operation_failed");
      return 1;
    } finally {
      if (input != null) Array.Clear(input, 0, input.Length);
      if (result != null) Array.Clear(result, 0, result.Length);
      if (output != null) Array.Clear(output, 0, output.Length);
    }
  }
}
