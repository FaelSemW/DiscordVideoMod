using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;

namespace DiscordInjector {
    public class InjectorForm : Form {
        private Label lblTitle;
        private Label lblStatus;
        private ProgressBar progressBar;
        private BackgroundWorker worker;

        public InjectorForm() {
            this.Text = "Discord Mod Injetor Setup";
            this.Size = new Size(500, 240);
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.MinimizeBox = false;
            this.StartPosition = FormStartPosition.CenterScreen;
            this.BackColor = Color.FromArgb(43, 45, 49);
            this.ForeColor = Color.White;

            try {
                using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("app.ico")) {
                    if (s != null) this.Icon = new Icon(s);
                }
            } catch {}

            lblTitle = new Label();
            lblTitle.Text = "Injetor Discord Mod (Leve)";
            lblTitle.Font = new Font("Segoe UI", 15, FontStyle.Bold);
            lblTitle.Location = new Point(30, 25);
            lblTitle.AutoSize = true;
            lblTitle.ForeColor = Color.FromArgb(242, 243, 245);
            this.Controls.Add(lblTitle);

            lblStatus = new Label();
            lblStatus.Text = "Localizando instalacao do Discord...";
            lblStatus.Font = new Font("Segoe UI", 10, FontStyle.Regular);
            lblStatus.Location = new Point(32, 75);
            lblStatus.Size = new Size(430, 30);
            lblStatus.ForeColor = Color.FromArgb(181, 186, 193);
            this.Controls.Add(lblStatus);

            progressBar = new ProgressBar();
            progressBar.Location = new Point(32, 120);
            progressBar.Size = new Size(420, 24);
            progressBar.Style = ProgressBarStyle.Continuous;
            this.Controls.Add(progressBar);

            worker = new BackgroundWorker();
            worker.WorkerReportsProgress = true;
            worker.DoWork += Worker_DoWork;
            worker.ProgressChanged += Worker_ProgressChanged;
            worker.RunWorkerCompleted += Worker_RunWorkerCompleted;

            this.Load += (s, e) => worker.RunWorkerAsync();
        }

        private void Worker_ProgressChanged(object sender, ProgressChangedEventArgs e) {
            progressBar.Value = Math.Min(100, Math.Max(0, e.ProgressPercentage));
            if (e.UserState != null) {
                lblStatus.Text = e.UserState.ToString();
            }
        }

        private void Worker_DoWork(object sender, DoWorkEventArgs e) {
            try {
                worker.ReportProgress(15, "Fechando Discord...");
                foreach (var p in Process.GetProcessesByName("Discord")) {
                    try { p.Kill(); p.WaitForExit(2000); } catch {}
                }
                Thread.Sleep(400);

                string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                string modDir = Path.Combine(localAppData, "RafaDiscord", "mod");
                Directory.CreateDirectory(modDir);

                worker.ReportProgress(40, "Instalando scripts do Mod...");
                Assembly asm = Assembly.GetExecutingAssembly();
                string resourceName = null;
                foreach (var name in asm.GetManifestResourceNames()) {
                    if (name.EndsWith("injector_payload.zip", StringComparison.OrdinalIgnoreCase)) {
                        resourceName = name;
                        break;
                    }
                }

                if (resourceName != null) {
                    string tempZip = Path.Combine(Path.GetTempPath(), "discord_mod_inj_" + Guid.NewGuid().ToString("N") + ".zip");
                    using (Stream resStream = asm.GetManifestResourceStream(resourceName))
                    using (FileStream fs = new FileStream(tempZip, FileMode.Create, FileAccess.Write)) {
                        resStream.CopyTo(fs);
                    }

                    using (ZipArchive archive = ZipFile.OpenRead(tempZip)) {
                        foreach (var entry in archive.Entries) {
                            string destPath = Path.Combine(modDir, entry.FullName);
                            if (entry.FullName.StartsWith("mod/")) {
                                destPath = Path.Combine(modDir, entry.FullName.Substring(4));
                            }
                            if (string.IsNullOrEmpty(entry.Name)) {
                                Directory.CreateDirectory(destPath);
                            } else {
                                Directory.CreateDirectory(Path.GetDirectoryName(destPath));
                                entry.ExtractToFile(destPath, true);
                            }
                        }
                    }
                    try { File.Delete(tempZip); } catch {}
                }

                worker.ReportProgress(70, "Injetando gancho no Discord oficial...");
                string[] dirs = new string[] {
                    Path.Combine(localAppData, "Discord"),
                    Path.Combine(localAppData, "DiscordCanary"),
                    Path.Combine(localAppData, "DiscordPTB")
                };

                string mainCjsEscaped = Path.Combine(modDir, "main.cjs").Replace("\\", "\\\\");
                string loaderCode = "// Rafa video experiment loader v1\ntry {\n  require('" + mainCjsEscaped + "');\n} catch (e) { console.error('[Mod] Falha:', e); }\nmodule.exports = require('./core.asar');\n";

                bool injected = false;
                foreach (var d in dirs) {
                    if (!Directory.Exists(d)) continue;
                    foreach (var file in Directory.GetFiles(d, "index.js", SearchOption.AllDirectories)) {
                        if (file.IndexOf("discord_desktop_core", StringComparison.OrdinalIgnoreCase) >= 0 &&
                            file.EndsWith("discord_desktop_core\\index.js", StringComparison.OrdinalIgnoreCase)) {
                            File.WriteAllText(file, loaderCode);
                            injected = true;
                        }
                    }
                }

                worker.ReportProgress(100, injected ? "Mod aplicado com sucesso! Abrindo Discord..." : "Discord instalado com sucesso!");
                Thread.Sleep(800);

                string discordExe = Path.Combine(localAppData, "Discord", "Update.exe");
                if (File.Exists(discordExe)) {
                    Process.Start(new ProcessStartInfo {
                        FileName = discordExe,
                        Arguments = "--processStart Discord.exe"
                    });
                }
            } catch (Exception ex) {
                MessageBox.Show("Erro: " + ex.Message, "Erro no Injetor", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void Worker_RunWorkerCompleted(object sender, RunWorkerCompletedEventArgs e) {
            this.Close();
        }

        [STAThread]
        public static void Main() {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new InjectorForm());
        }
    }
}
