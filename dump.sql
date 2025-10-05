-- phpMyAdmin SQL Dump
-- Fixed version for MySQL/MariaDB import
-- Host: 127.0.0.1
-- Generation Time: Oct 06, 2025
-- Server version: 10.4.32-MariaDB
-- PHP Version: 8.0.30

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";

-- Database: `check`
-- --------------------------------------------------------

-- Table structure for table `clearances`
CREATE TABLE `clearances` (
  `clearance_id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `cashier_status` enum('Pending','Approved','Rejected') DEFAULT 'Pending',
  `cashier_reason` text DEFAULT NULL,
  `registrar_status` varchar(20) DEFAULT 'pending',
  `registrar_reason` varchar(255) DEFAULT NULL,
  `guidance_status` varchar(20) DEFAULT 'pending',
  `guidance_reason` varchar(255) DEFAULT NULL,
  `engineering_status` varchar(20) DEFAULT 'pending',
  `engineering_reason` varchar(255) DEFAULT NULL,
  `criminology_status` varchar(20) DEFAULT 'pending',
  `criminology_reason` varchar(255) DEFAULT NULL,
  `mis_status` varchar(20) DEFAULT 'pending',
  `mis_reason` varchar(255) DEFAULT NULL,
  `library_status` varchar(20) DEFAULT 'pending',
  `library_reason` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`clearance_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Insert data for `clearances`
INSERT INTO `clearances` (`clearance_id`, `user_id`, `cashier_status`, `cashier_reason`, `registrar_status`, `registrar_reason`, `guidance_status`, `guidance_reason`, `engineering_status`, `engineering_reason`, `criminology_status`, `criminology_reason`, `mis_status`, `mis_reason`, `library_status`, `library_reason`) VALUES
(NULL, 7, 'Approved', 'No payment', 'approved', 'jjggfghjk', 'approved', NULL, 'rejected', NULL, 'pending', NULL, 'pending', NULL, 'approved', NULL),
(NULL, 8, 'Approved', NULL, 'pending', NULL, 'pending', NULL, 'pending', NULL, 'pending', NULL, 'pending', NULL, 'pending', NULL),
(NULL, 11, 'Pending', NULL, 'pending', NULL, 'pending', NULL, 'pending', NULL, 'pending', NULL, 'pending', NULL, 'pending', NULL),
(NULL, 26, 'Pending', NULL, 'approved', 'alalang', 'pending', NULL, 'pending', NULL, 'pending', NULL, 'pending', NULL, 'pending', NULL),
(NULL, 27, 'Pending', NULL, 'pending', NULL, 'pending', NULL, 'pending', NULL, 'pending', NULL, 'pending', NULL, 'pending', NULL),
(NULL, 28, 'Approved', NULL, 'pending', NULL, 'pending', NULL, 'pending', NULL, 'pending', NULL, 'pending', NULL, 'approved', NULL),
(NULL, 29, 'Pending', NULL, 'pending', NULL, 'pending', NULL, 'pending', NULL, 'pending', NULL, 'pending', NULL, 'pending', NULL),
(NULL, 26, 'Pending', NULL, 'pending', NULL, 'pending', NULL, 'pending', NULL, 'pending', NULL, 'pending', NULL, 'pending', NULL);

-- Table structure for table `document_types`
CREATE TABLE `document_types` (
  `document_id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `description` text DEFAULT NULL,
  `processing_time` text DEFAULT NULL,
  `fee` decimal(10,2) DEFAULT 0.00,
  `category` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`document_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Insert data for `document_types`
INSERT INTO `document_types` (`document_id`, `name`, `description`, `processing_time`, `fee`, `category`) VALUES
(1, 'Good Moral Certificate', 'Certificate attesting to a student\'s good conduct and character', '2-3 business days', 100.00, 'certificates'),
(2, 'Certificate of Registration', 'Document verifying current enrollment status', '1-2 business days', 50.00, 'miscellaneous'),
(3, 'Certificate of Grades', 'Verification and authentication of academic grades', '1-2 business days', 75.00, 'miscellaneous'),
(4, 'Transcript of Records', 'Official academic record showing courses taken and grades earned', '5-7 business days', 200.00, 'main documents'),
(5, 'Form 137 (School Records)', 'Comprehensive academic records for K-12 students', '3-5 business days', 150.00, 'main documents'),
(6, 'Diploma', 'Official document certifying completion of a course of study', '10-15 business days', 500.00, 'main documents'),
(7, 'Certification of Graduation', 'Document certifying successful completion of a degree program', '2-4 business days', 150.00, 'certificates'),
(8, 'Honorable Dismissal', 'An official release from school duties granted with recognition of good conduct and service.', '2-3 business days', 100.00, 'main documents'),
(9, 'Cross Enrollment', 'The process of enrolling in courses at another school or institution while remaining registered at the home institution.', '2-3 business days', 100.00, 'certificates'),
(10, 'Enrollment', 'An official document certifying a student’s current enrollment in a school or program.', '2-3 business days', 100.00, 'certificates'),
(11, 'GPA / GWA', 'An official document showing a student’s Grade Point Average (GPA) or General Weighted Average (GWA).', '2-3 business days', 100.00, 'certificates'),
(12, 'M.O.I. English', 'An official certificate verifying a student’s proficiency in English as the Medium of Instruction (M.O.I.).', '2-3 business days', 100.00, 'certificates'),
(13, 'Special Order', 'An official document issued to formalize administrative decisions, assignments, or approvals.', '2-3 business days', 100.00, 'certificates'),
(14, 'Evaluation Certificate', 'An official document certifying the assessment or performance of a student.', '2-3 business days', 100.00, 'miscellaneous'),
(15, 'Course Description', 'A brief summary outlining the content, objectives, and scope of a course.', '2-3 business days', 100.00, 'miscellaneous');

-- Table structure for table `requests`
CREATE TABLE `requests` (
  `request_id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT,
  `student_id` int(11) NOT NULL,
  `document_id` int(11) NOT NULL,
  `payment` text NOT NULL,
  `status` varchar(50) DEFAULT 'Pending',
  `release_date` timestamp NULL DEFAULT NULL,
  `submission_date` text NOT NULL,
  `reason` text DEFAULT NULL,
  `payment_attachment` text DEFAULT NULL,
  `reference_no` text DEFAULT NULL,
  `amount` text DEFAULT NULL,
  `rejection_reason` text DEFAULT NULL,
  `request_rejection` text DEFAULT NULL,
  PRIMARY KEY (`request_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Insert data for `requests`
INSERT INTO `requests` (`request_id`, `student_id`, `document_id`, `payment`, `status`, `release_date`, `submission_date`, `reason`, `payment_attachment`, `reference_no`, `amount`, `rejection_reason`, `request_rejection`) VALUES
(NULL, 7, 4, 'approved', 'in progress', '2025-09-11 16:00:00', '2025-09-07 21:26:40', 'Scholarship', 'attachments\\1758810352804-Screenshot (1).png', '455435', '1000', 'so sad', 'magtrabaho kaaa'),
(NULL, 7, 1, 'pending', 'rejected', '2025-09-15 16:00:00', '2025-09-14 21:26:38', 'Transferring', 'attachments\\1758754136195-Screenshot (1).png', '122344', '1000', NULL, 'Did not pass Birth Certificate'),
(NULL, 26, 1, 'approved', 'Approved', '2025-09-15 16:00:00', '2025-09-14 22:23:40', 'Transferring', 'attachments\\1759370920765-Cream and Brown Aesthetic Thank You Instagram Post (1).jpg', '12233444', '100', NULL, NULL),
(NULL, 27, 6, 'approved', 'Approved', '2025-09-23 16:00:00', '2025-09-14 22:30:59', 'Transferring', 'attachments\\1759370920765-Cream and Brown Aesthetic Thank You Instagram Post (1).jpg', '12233444', '100', NULL, NULL),
(NULL, 28, 2, 'approved', 'Approved', '2025-09-17 16:00:00', '2025-09-17 23:16:48', 'Enrollment', 'attachments\\1759370920765-Cream and Brown Aesthetic Thank You Instagram Post (1).jpg', '12233444', '100', NULL, NULL),
(NULL, 28, 4, 'approved', 'Approved', '2025-09-22 16:00:00', '2025-09-18 10:02:46', 'aa', 'attachments\\1759370920765-Cream and Brown Aesthetic Thank You Instagram Post (1).jpg', '12233444', '100', NULL, NULL),
(NULL, 7, 8, 'approved', 'Approved', '2025-09-26 16:00:00', '2025-09-25 09:02:22', 'Transferring', 'attachments\\1759370920765-Cream and Brown Aesthetic Thank You Instagram Post (1).jpg', '12233444', '100', NULL, NULL),
(NULL, 29, 1, 'approved', 'Approved', '2025-09-26 16:00:00', '2025-09-25 21:48:36', 'Transferring', 'attachments\\1759370920765-Cream and Brown Aesthetic Thank You Instagram Post (1).jpg', '12233444', '100', NULL, NULL),
(NULL, 7, 2, 'approved', 'Approved', '2025-10-02 16:00:00', '2025-10-02 09:11:22', 'Enrollment', 'attachments\\1759370920765-Cream and Brown Aesthetic Thank You Instagram Post (1).jpg', '12233444', '100', NULL, NULL),
(NULL, 26, 5, 'approved', 'Approved', '2025-10-04 16:00:00', '2025-10-02 09:56:02', 'Work', 'attachments\\1759370920765-Cream and Brown Aesthetic Thank You Instagram Post (1).jpg', '12233444', '100', NULL, NULL),
(NULL, 26, 9, 'approved', 'Approved', '2025-10-03 16:00:00', '2025-10-02 10:08:15', 'Enrollment', 'attachments\\1759370920765-Cream and Brown Aesthetic Thank You Instagram Post (1).jpg', '12233444', '100', NULL, NULL);

-- Table structure for table `request_clearances`
CREATE TABLE `request_clearances` (
  `clearance_id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT,
  `request_id` bigint(20) UNSIGNED NOT NULL,
  `registrar_status` varchar(20) DEFAULT 'pending',
  `registrar_reason` text DEFAULT NULL,
  `guidance_status` varchar(20) DEFAULT 'pending',
  `guidance_reason` text DEFAULT NULL,
  `engineering_status` varchar(20) DEFAULT 'pending',
  `engineering_reason` text DEFAULT NULL,
  `criminology_status` varchar(20) DEFAULT 'pending',
  `criminology_reason` text DEFAULT NULL,
  `mis_status` varchar(20) DEFAULT 'pending',
  `mis_reason` text DEFAULT NULL,
  `library_status` varchar(20) DEFAULT 'pending',
  `library_reason` text DEFAULT NULL,
  `cashier_status` varchar(20) DEFAULT 'pending',
  `cashier_reason` text DEFAULT NULL,
  `registrar_approved_at` datetime DEFAULT NULL,
  `guidance_approved_at` datetime DEFAULT NULL,
  `engineering_approved_at` datetime DEFAULT NULL,
  `criminology_approved_at` datetime DEFAULT NULL,
  `mis_approved_at` datetime DEFAULT NULL,
  `library_approved_at` datetime DEFAULT NULL,
  `cashier_approved_at` datetime DEFAULT NULL,
  PRIMARY KEY (`clearance_id`),
  KEY `fk_request` (`request_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Insert data for `request_clearances`
INSERT INTO `request_clearances` (`clearance_id`, `request_id`, `registrar_status`, `registrar_reason`, `guidance_status`, `guidance_reason`, `engineering_status`, `engineering_reason`, `criminology_status`, `criminology_reason`, `mis_status`, `mis_reason`, `library_status`, `library_reason`, `cashier_status`, `cashier_reason`, `registrar_approved_at`, `guidance_approved_at`, `engineering_approved_at`, `criminology_approved_at`, `mis_approved_at`, `library_approved_at`, `cashier_approved_at`) VALUES
(NULL, 1, 'approved', NULL, 'approved', NULL, 'approved', NULL, 'approved', NULL, 'approved', NULL, 'approved', NULL, 'approved', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
(NULL, 2, 'approved', NULL, 'approved', NULL, 'approved', NULL, 'approved', NULL, 'approved', NULL, 'approved', NULL, 'approved', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
(NULL, 5, 'approved', NULL, 'approved', NULL, 'approved', NULL, 'approved', NULL, 'approved', NULL, 'approved', NULL, 'approved', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
(NULL, 4, 'pending', NULL, 'pending', NULL, 'pending', NULL, 'pending', NULL, 'pending', NULL, 'pending', NULL, 'pending', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
(NULL, 3, 'rejected', 'Sorry napindot', 'approved', NULL, 'rejected', 'sad', 'pending', NULL, 'pending', NULL, 'pending', NULL, 'pending', NULL, NULL, '2025-10-05 03:01:17', NULL, NULL, NULL, NULL, NULL, NULL),
(NULL, 6, 'pending', NULL, 'pending', NULL, 'pending', NULL, 'pending', NULL, 'pending', NULL, 'pending', NULL, 'pending', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);

-- Table structure for table `user`
CREATE TABLE `user` (
  `uid` int(11) NOT NULL AUTO_INCREMENT,
  `username` varchar(255) NOT NULL,
  `email` varchar(255) NOT NULL,
  `password` text NOT NULL,
  `course` text NOT NULL,
  `role` text NOT NULL,
  `department` varchar(50) DEFAULT NULL,
  `student_number` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`uid`),
  UNIQUE KEY `student_id` (`student_number`),
  UNIQUE KEY `username` (`username`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Insert data for `user`
INSERT INTO `user` (`uid`, `username`, `email`, `password`, `course`, `role`, `department`, `student_number`) VALUES
(NULL, 'Super Admin', 'superadmin@gmail.com', '$2b$10$blZWGYjVRS8vHJ6AqNMqQuwIdrnENrNz57sZcEoo1bECXwg530nsu', 'bachelor of science in information technology', 'super admin', NULL, NULL),
(NULL, 'test', 'test@gmail.com', '$2b$10$TKbTyoHVVI/agPovPgvwleqzoIsC86A0xNuH2seGOntCCSDHPe7xq', 'bachelor of science in information technology', 'student', NULL, NULL),
(NULL, 'testinglang', 'testingnew@gmail.com', '$2b$10$Tdglr6Jfjo2.o8GGT5DVieBvgyRGCHYKxWIloFg9Z3429uDcE5OVq', 'bachelor of science in information technology', 'student', NULL, NULL),
(NULL, 'cashier_office', 'cashier@gmail.com', '$2b$10$pZTKgqLeQW7KQLImixtNQ.XYCIsOSV8OSFtRgG.te9EnWbGKC2plC', 'N/A', 'admin', 'cashier', NULL),
(NULL, 'Librarian', 'librarian@heroes1997.edu.ph', '$2b$10$OiJSq6m7Ic2vx3fnOUpU8uYU/s6okxigkU2d4JreJTQp0/h27/lja', '', 'admin', 'library', NULL),
(NULL, 'Registrar', 'registrar@heroes1997.edu.ph', '$2b$10$zddIrNHm/epiB/53a1EaD.E9jg3GWsTEOugVdW8UD6JC17QPwZOW.', 'N/A', 'admin', 'registrar', NULL),
(NULL, 'Guidance', 'guidance@heroes1997.edu.ph', '$2b$10$WDBfbA6pJNOY3OH3rjHyi.g9ULDFV/g30.S5wKY/kalGCmVSAftjS', 'N/A', 'admin', 'guidance', NULL),
(NULL, 'Clinic', 'clinic@heroes1997.edu.ph', '$2b$10$nHg0BvhG6nBfhVzarKeM6eU/vcvC5r0gQgQgAFE5A4p0XCF0/HN/i', 'N/A', 'admin', 'clinic', NULL),
(NULL, 'Accounting', 'accounting@heroes.edu.ph', '$2b$10$PLXC7WjlT6A2MVc9w5t89O8ugKR.z5Gbn7cf2wH8RHsj.Xovd6Q3i', 'N/A', 'admin', 'accounting', NULL),
(NULL, 'MIS Admin', 'mis@heroes1997.edu.ph', '$2b$10$fwM3hjxEuU0zR1bQCRNkYerCA7s6N3.XNP5x9Y2SPDCN.e6FOYGMi', 'N/A', 'admin', 'mis', NULL),
(NULL, 'Engineering Admin', 'engineering@heroes1997.edu.ph', '$2b$10$IPwKTyj//ealVv7sUQCxP.vueyPX3rHm2CvUGxgVdWGvOa6xq1SQS', 'N/A', 'admin', 'engineering', NULL),
(NULL, 'Criminology Admin', 'criminology@heroes1997.edu.ph', '$2b$10$VqOD/Akc/B0E3z3t9TQpqeK.fz1mpjNqVIshUHiAwTJTRm3DM/6nu', 'N/A', 'admin', 'criminology', NULL),
(NULL, '1', 'agatdula2014@heroes1979.edu.ph', '$2b$10$MMPM6Pd9A/FDYjC98shdj.06Pmt4vzw0OZ5ScHumfOl59XM4nBYqy', 'bachelor of science in information technology', 'student', NULL, NULL),
(NULL, 'tey', '2201190@heroes1979.edu.ph', '$2b$10$EN.Vvo5a7g8GWONuYLpFZuvilx1MuBhayDVTErHYV3/wOFWpf.1Qy', 'bachelor of science in information technology', 'student', NULL, '2201190');

COMMIT;
