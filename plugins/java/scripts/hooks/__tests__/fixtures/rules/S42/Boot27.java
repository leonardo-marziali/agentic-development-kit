package demo;

class Boot27 {

    String detail(RuntimeException exception) {
        Problem problem = new Problem();
        problem.setDetail(exception.getMessage());
        return problem.toString();
    }

    static class Problem {
        void setDetail(String detail) {
        }
    }

}
