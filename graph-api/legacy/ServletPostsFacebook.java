package export;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import javax.servlet.ServletException;
import javax.servlet.annotation.WebServlet;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

@WebServlet(name = "ServletPostsFacebook", urlPatterns = {"/api/facebook/posts"})
public class ServletPostsFacebook extends HttpServlet {

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
            String since = request.getParameter("since");
            String until = request.getParameter("until");
            
            StringBuilder endpoint = new StringBuilder("http://" + BACKEND_IP + ":" + BACKEND_PORT + "/facebook/posts");
            
            // Ajouter les paramètres de filtre par date
            if ((since != null && !since.isEmpty()) || (until != null && !until.isEmpty())) {
                endpoint.append("?");
                if (since != null && !since.isEmpty()) {
                    endpoint.append("since=").append(URLEncoder.encode(since, "UTF-8"));
                }
                if (until != null && !until.isEmpty()) {
                    if (since != null && !since.isEmpty()) {
                        endpoint.append("&");
                    }
                    endpoint.append("until=").append(URLEncoder.encode(until, "UTF-8"));
                }
            }

            URL url = new URL(endpoint.toString());
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
        
        out.print("{\"error\":\"POST /facebook/posts nécessite un multipart form-data. Veuillez utiliser le formulaire réservé.\"}");
        response.setStatus(HttpServletResponse.SC_BAD_REQUEST);
        out.flush();
    }
}
