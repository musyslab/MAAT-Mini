import React from 'react'
import { Link } from 'react-router-dom'
import { FaHome } from 'react-icons/fa'
import '../../styling/MenuComponent.scss'

interface MenuComponentProps {
  showUpload: boolean
  showAdminUpload: boolean
  showHelp: boolean
  showCreate: boolean
  showReviewButton: boolean
  showLast: boolean
}

export default function MenuComponent(_props: MenuComponentProps) {
  return (
    <header className="mini-menu">
      <Link className="mini-menu__brand" to="/admin/schools">
        <FaHome />
        <span>MAAT-Mini</span>
      </Link>
    </header>
  )
}
