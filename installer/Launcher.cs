using System;
using System.Diagnostics;
using System.IO;
using System.Text.RegularExpressions;
using System.Collections.Generic;

class Launcher {
    static void Main() {
        string baseDir = AppDomain.CurrentDomain.BaseDirectory;
        string clientExe = Path.Combine(baseDir, "client", "Discord.exe");
        if (!File.Exists(clientExe)) return;

        string info = File.ReadAllText(Path.Combine(baseDir, "client", "resources", "build_info.json"));
        string version = Regex.Match(info, "\"version\"\\s*:\\s*\"([^\"]+)\"").Groups[1].Value;
        if (String.IsNullOrEmpty(version)) throw new InvalidDataException("Versao do cliente ausente");
        string modules = Path.Combine(baseDir, "profile", "discord", version, "modules");
        Directory.CreateDirectory(modules);
        var manifest = new List<string>();
        foreach (string versionDir in Directory.GetDirectories(Path.Combine(baseDir, "client", "modules"))) {
            foreach (string moduleDir in Directory.GetDirectories(versionDir)) {
                string name = Path.GetFileName(moduleDir);
                string dest = Path.Combine(modules, name);
                if (!Directory.Exists(dest)) CopyDirectory(moduleDir, dest);
                manifest.Add("\"" + name + "\":{\"installedVersion\":1}");
            }
        }
        string manifestPath = Path.Combine(modules, "installed.json");
        if (!File.Exists(manifestPath)) File.WriteAllText(manifestPath, "{" + String.Join(",", manifest) + "}");
        string mainPath = Path.Combine(baseDir, "mod", "main.cjs").Replace("\\", "\\\\").Replace("'", "\\'");
        File.WriteAllText(Path.Combine(modules, "discord_desktop_core", "index.js"),
            "try { require('" + mainPath + "'); } catch (e) { console.error(e); }\nmodule.exports = require('./core.asar');\n");

        ProcessStartInfo psi = new ProcessStartInfo();
        psi.FileName = clientExe;
        psi.WorkingDirectory = Path.GetDirectoryName(clientExe);
        psi.UseShellExecute = false;

        psi.EnvironmentVariables["RAFA_DISCORD_MOD_ROOT"] = baseDir;
        psi.EnvironmentVariables["DISCORD_USER_DATA_DIR"] = Path.Combine(baseDir, "profile");
        psi.EnvironmentVariables["APPDATA"] = Path.Combine(baseDir, "profile", "roaming");
        psi.EnvironmentVariables["LOCALAPPDATA"] = Path.Combine(baseDir, "profile", "local");
        psi.EnvironmentVariables["TEMP"] = Path.Combine(baseDir, "runtime", "temp");
        psi.EnvironmentVariables["TMP"] = psi.EnvironmentVariables["TEMP"];

        Directory.CreateDirectory(Path.Combine(baseDir, "profile", "roaming"));
        Directory.CreateDirectory(Path.Combine(baseDir, "profile", "local"));
        Directory.CreateDirectory(Path.Combine(baseDir, "runtime", "temp"));

        Process.Start(psi);
    }

    static void CopyDirectory(string source, string target) {
        Directory.CreateDirectory(target);
        foreach (string file in Directory.GetFiles(source)) File.Copy(file, Path.Combine(target, Path.GetFileName(file)), false);
        foreach (string dir in Directory.GetDirectories(source)) CopyDirectory(dir, Path.Combine(target, Path.GetFileName(dir)));
    }
}
