' Starts ONEM1ND without a console window. Arguments: the runtime (node), the CLI of the M1ND, the M1ND folder, the
' sentence to show when the app cannot start, and optionally the local Cosmic folder. The CLI starts the service
' detached when it is not running, reuses it when it is, and opens the viewer in the browser. Nothing is printed.
Option Explicit
Dim shell, command, code
If WScript.Arguments.Count < 4 Then WScript.Quit 2
Set shell = CreateObject("WScript.Shell")
' An app that packages its own Node (Electron) runs the CLI as plain Node when this is set; real Node ignores it.
shell.Environment("Process")("ELECTRON_RUN_AS_NODE") = "1"
command = """" & WScript.Arguments(0) & """ """ & WScript.Arguments(1) & """ service launch --mind-path """ & WScript.Arguments(2) & """"
If WScript.Arguments.Count > 4 Then
  If Len(WScript.Arguments(4)) > 0 Then command = command & " --cosmic-path """ & WScript.Arguments(4) & """"
End If
code = shell.Run(command, 0, True)
If code <> 0 Then MsgBox WScript.Arguments(3), 48, "ONEM1ND"
