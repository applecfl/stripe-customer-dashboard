const SERVER_URL = "http://12.5.183.44:5782/API/";

export async function runServerCommand(
  value: string,
  type: string,
  progName: string = "SP"
): Promise<string> {
  const serverSecret = process.env.SERVER_SECRET;
  const appName = process.env.SERVER_APP_NAME || "SERVER";

  if (!serverSecret) {
    throw new Error('SERVER_SECRET not configured');
  }

  const formdata = new FormData();
  formdata.append("APPNAME", appName);
  formdata.append("PRGNAME", progName);
  formdata.append("ARGUMENTS", "A,B,C");
  formdata.append("A", serverSecret);
  formdata.append("B", type);
  formdata.append("C", value);

  console.log('runServerCommand:', { APPNAME: appName, PRGNAME: progName, B: type, C: value });

  const response = await fetch(SERVER_URL, {
    method: "POST",
    body: formdata,
    redirect: "follow",
  });

  // Server returns UTF-16LE encoded response
  const buffer = await response.arrayBuffer();
  const decoder = new TextDecoder('utf-16le');
  return decoder.decode(buffer);
}
