package export;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.PrintWriter;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import javax.servlet.ServletException;
import javax.servlet.annotation.WebServlet;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

@WebServlet(name = "ServletCommentsFacebook", urlPatterns = {"/api/facebook/comments/*"})
public class ServletCommentsFacebook extends HttpServlet {

    // Legacy reference file, not part of the running app (see legacy/README.md).
    // The original hardcoded internal IP was removed during Sprint 05 hardening.
    private static final String BACKEND_IP = "REPLACE_WITH_BACKEND_HOST";
    private static final String BACKEND_PORT = "8000";

    @Override
    protected void doGet(HttpServletRequest request, HttpServletResponse response)
            throws ServletException, IOException {
        response.setContentType("application/json");
        response.setCharacterEncoding("UTF-8");

        PrintWriter out = response.getWriter();
        HttpURLConnection connection = null;
        BufferedReader reader = null;

        try {
            String pathInfo = request.getPathInfo();
            if (pathInfo == null || pathInfo.isEmpty()) {
                response.setStatus(HttpServletResponse.SC_BAD_REQUEST);
                out.print("{\"error\":\"Path manquant\"}");
                out.flush();
                return;
            }

            // Construire le endpoint Python basé sur le path info
            // Ex: /post_id/comments ou /comment_id/replies
            String endpoint = "http://" + BACKEND_IP + ":" + BACKEND_PORT + "/facebook" + pathInfo;

            URL url = new URL(endpoint);
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(10000);
            connection.setReadTimeout(10000);

            int statusCode = connection.getResponseCode();
            if (statusCode >= 200 && statusCode < 300) {
                reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), "UTF-8"));
            } else {
                reader = new BufferedReader(new InputStreamReader(connection.getErrorStream(), "UTF-8"));
                response.setStatus(statusCode);
            }

            StringBuilder body = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                body.append(line);
            }

            out.print(body.toString());
        } catch (Exception e) {
            response.setStatus(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
            out.print("{\"error\":\"" + e.getMessage().replace("\"", "'") + "\"}");
        } finally {
            if (reader != null) {
                reader.close();
            }
            if (connection != null) {
                connection.disconnect();
            }
            out.flush();
        }
    }

    @Override
    protected void doPost(HttpServletRequest request, HttpServletResponse response)
            throws ServletException, IOException {
        response.setContentType("application/json");
        response.setCharacterEncoding("UTF-8");

        PrintWriter out = response.getWriter();
        HttpURLConnection connection = null;
        BufferedReader reader = null;

        try {
            String pathInfo = request.getPathInfo();
            if (pathInfo == null || pathInfo.isEmpty()) {
                response.setStatus(HttpServletResponse.SC_BAD_REQUEST);
                out.print("{\"error\":\"Path manquant\"}");
                out.flush();
                return;
            }

            // Lire le body JSON de la requête
            StringBuilder body = new StringBuilder();
            try (BufferedReader br = request.getReader()) {
                String line;
                while ((line = br.readLine()) != null) {
                    body.append(line);
                }
            }

            // Construire le endpoint Python
            // Ex: /comment_id/reply
            String endpoint = "http://" + BACKEND_IP + ":" + BACKEND_PORT + "/facebook" + pathInfo;

            URL url = new URL(endpoint);
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("POST");
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("Content-Length", String.valueOf(body.length()));
            connection.setConnectTimeout(10000);
            connection.setReadTimeout(10000);
            connection.setDoOutput(true);

            // Envoyer le body
            try (OutputStream os = connection.getOutputStream()) {
                os.write(body.toString().getBytes("UTF-8"));
                os.flush();
            }

            int statusCode = connection.getResponseCode();
            if (statusCode >= 200 && statusCode < 300) {
                reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), "UTF-8"));
            } else {
                reader = new BufferedReader(new InputStreamReader(connection.getErrorStream(), "UTF-8"));
                response.setStatus(statusCode);
            }

            StringBuilder responseBody = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                responseBody.append(line);
            }

            out.print(responseBody.toString());
        } catch (Exception e) {
            response.setStatus(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
            out.print("{\"error\":\"" + e.getMessage().replace("\"", "'") + "\"}");
        } finally {
            if (reader != null) {
                reader.close();
            }
            if (connection != null) {
                connection.disconnect();
            }
            out.flush();
        }
    }
}
