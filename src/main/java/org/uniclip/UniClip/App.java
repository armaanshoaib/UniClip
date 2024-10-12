package org.uniclip.UniClip;

import io.socket.client.IO;
import io.socket.client.Socket;
import io.socket.emitter.Emitter;

import javax.swing.*;
import java.awt.*;
import java.awt.datatransfer.*;
import java.net.URI;

public class App extends JFrame {
	public final JLabel dispImg;
    private static Socket socket;
    public static JButton connectButton;
    private JLabel statusLabel;
    public final JLabel headingLabel ;
    public static boolean desktopConnected = false;
    // //constructor
    public App() {
    	ImageIcon img = new ImageIcon("ucLogo.png");
        setTitle("UniClip (Desktop Client)");
        setSize(300, 150);
        headingLabel = new JLabel("<html> UniClip  </html>");
        headingLabel.setFont(new Font("Segoe UI", Font.PLAIN, 18));
        setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);
        setLayout(new FlowLayout());
        dispImg = new JLabel(img);
        add(dispImg);
        statusLabel = new JLabel("Connect to server");
        connectButton = new JButton("Connect");

        connectButton.addActionListener(e -> connectToServer());
        add(headingLabel);
        add(statusLabel);
        add(connectButton);
        setVisible(true);
    }

    private void connectToServer() {
    	if(!desktopConnected) {
    	
        try {
        	// // ec2 server ip addr and port no
            URI uri = URI.create("http://43.204.82.67:3001"); 
            socket = IO.socket(uri);
            socket.on(Socket.EVENT_CONNECT, args -> {
                System.out.println("Connected to server");
                socket.emit("clientType", "desktop");
                statusLabel.setText("Waiting for mobile client");
                connectButton.setText("close app to disconnect");
            });

            socket.on("status", args -> {
                String status = (String) args[0];
                System.out.println("Server status: " + status);
                statusLabel.setText(status);
            });

            socket.on("updateClipboard", args -> {
                String text = (String) args[0];
                System.out.println("Text received from mobile: " + text);
                setClipboardContents(text);
                
            });

            socket.connect();
            desktopConnected = true;
            connectButton.setEnabled(false);
        } catch (Exception e) {
            e.printStackTrace();
        }
    	}
    }

    // //copy text to clipboard
    private void setClipboardContents(String str) {
        Clipboard clipboard = Toolkit.getDefaultToolkit().getSystemClipboard();
        StringSelection stringSelection = new StringSelection(str);
        clipboard.setContents(stringSelection, null);
    }

    // // get text from clipboard
    private String getClipboardContents() {
        try {
            Clipboard clipboard = Toolkit.getDefaultToolkit().getSystemClipboard();
            return (String) clipboard.getContents(null).getTransferData(DataFlavor.stringFlavor);
        } catch (Exception e) {
            return "";
        }
    }

    public static void main(String[] args) {
        App client = new App();
        Clipboard clipboard = Toolkit.getDefaultToolkit().getSystemClipboard();
        String lastText = client.getClipboardContents();
            while (true) {
                String currentText = client.getClipboardContents();
                if (!currentText.equals(lastText) && socket != null && socket.connected()) {
                    socket.emit("desktopCopy", currentText);
                    lastText = currentText;
                }
                try { 
                	// // refresh every 2 secs
                    Thread.sleep(2000);
                } catch (InterruptedException ignored) {
                }
            }
  
    }
}
